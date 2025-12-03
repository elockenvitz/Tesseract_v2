/**
 * CreateWorkflowWizard Component
 *
 * Multi-step wizard for creating a new workflow template.
 * Walks users through all setup options to ensure version 1.0 is usable:
 * 1. Basic Info (name, description, color, cadence)
 * 2. Team & Admins
 * 3. Universe (asset eligibility rules)
 * 4. Stages
 * 5. Automation Rules
 */

import React, { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  FileText,
  Users,
  Filter,
  Layers,
  Zap,
  Plus,
  Trash2,
  Search,
  AlertCircle,
  GitBranch,
  Calendar,
  Edit2,
  Eye,
  Loader2
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { CadenceTimeframe } from '../../types/workflow'
import {
  FILTER_TYPE_REGISTRY,
  OPERATOR_LABELS,
  getFilterDefinition,
  FilterOperator
} from '../../lib/universeFilters'
import { AddRuleModal } from './modals/AddRuleModal'
import { AddAssetPopulationRuleModal } from './modals/AddAssetPopulationRuleModal'

// Types
interface FilterRule {
  id: string
  type: string
  operator: FilterOperator
  values: any
}

// Logic expression token types
type LogicToken =
  | { type: 'filter'; filterId: string }
  | { type: 'operator'; value: 'AND' | 'OR' }
  | { type: 'paren'; value: '(' | ')' }

interface TeamMember {
  id: string
  userId: string
  email: string
  name: string
  role: 'admin' | 'stakeholder'
}

interface WizardStage {
  stage_key: string
  stage_label: string
  stage_description: string
  stage_color: string
  stage_icon: string
  sort_order: number
  standard_deadline_days: number
  suggested_priorities: string[]
}

interface AutomationRuleData {
  id: string
  name: string
  type: 'time' | 'event'
  conditionType: string
  conditionValue: any
  actionType: string
  actionValue: any
  isActive: boolean
  rule_category: 'branch_creation' | 'asset_population'
}

interface CreateWorkflowWizardProps {
  onClose: () => void
  onComplete: (workflowId: string) => void
}

// Step definitions
const STEPS = [
  { id: 'basic', label: 'Basic Info', icon: FileText, description: 'Name and cadence' },
  { id: 'team', label: 'Team', icon: Users, description: 'Admins & stakeholders' },
  { id: 'universe', label: 'Universe', icon: Filter, description: 'Asset eligibility' },
  { id: 'stages', label: 'Stages', icon: Layers, description: 'Workflow stages' },
  { id: 'automation', label: 'Automation', icon: Zap, description: 'Rules & triggers' }
]

// Cadence options
const CADENCE_OPTIONS: { value: CadenceTimeframe; label: string; description: string }[] = [
  { value: 'persistent', label: 'Persistent', description: 'No automatic reset, continuous workflow' },
  { value: 'daily', label: 'Daily', description: 'Resets every day' },
  { value: 'weekly', label: 'Weekly', description: 'Resets every week' },
  { value: 'monthly', label: 'Monthly', description: 'Resets every month' },
  { value: 'quarterly', label: 'Quarterly', description: 'Resets every quarter' },
  { value: 'semi-annually', label: 'Semi-Annually', description: 'Resets every 6 months' },
  { value: 'annually', label: 'Annually', description: 'Resets every year' }
]

export function CreateWorkflowWizard({ onClose, onComplete }: CreateWorkflowWizardProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [currentStep, setCurrentStep] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form state
  const [basicInfo, setBasicInfo] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
    cadence_timeframe: 'quarterly' as CadenceTimeframe
  })

  const [team, setTeam] = useState<TeamMember[]>([])
  const [filters, setFilters] = useState<FilterRule[]>([])
  const [logicExpression, setLogicExpression] = useState<LogicToken[]>([])
  const [stages, setStages] = useState<WizardStage[]>([]) // Start with no stages
  const [automationRules, setAutomationRules] = useState<AutomationRuleData[]>([])

  // User search state
  const [userSearchTerm, setUserSearchTerm] = useState('')
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [selectedRole, setSelectedRole] = useState<'admin' | 'stakeholder'>('admin')

  // Universe filter modal state
  const [showFilterModal, setShowFilterModal] = useState(false)
  const [editingFilter, setEditingFilter] = useState<FilterRule | null>(null)
  const [filterType, setFilterType] = useState<string | null>(null)
  const [filterOperator, setFilterOperator] = useState<FilterOperator>('includes')
  const [filterValues, setFilterValues] = useState<any>(null)
  const [filterSearchTerm, setFilterSearchTerm] = useState('')
  const [selectedTokens, setSelectedTokens] = useState<Set<number>>(new Set())

  // Automation rule modal state
  const [showBranchRuleModal, setShowBranchRuleModal] = useState(false)
  const [showAssetRuleModal, setShowAssetRuleModal] = useState(false)

  // Universe preview state
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [previewAssets, setPreviewAssets] = useState<any[]>([])
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Query for users
  const { data: allUsers } = useQuery({
    queryKey: ['users-search'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name')
        .order('last_name')

      if (error) throw error
      return data.map(u => ({
        id: u.id,
        email: u.email,
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email
      }))
    }
  })

  // Filter users based on search and exclude already added
  const filteredUsers = allUsers?.filter(u =>
    !team.some(t => t.userId === u.id) &&
    u.id !== user?.id &&
    (u.name.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearchTerm.toLowerCase()))
  ) || []

  // Query for dropdown data (lists, themes, portfolios, analysts)
  const { data: lists } = useQuery({
    queryKey: ['asset-lists'],
    queryFn: async () => {
      const { data } = await supabase
        .from('asset_lists')
        .select('id, name')
        .order('name')
      return data?.filter(l => l.name).map(l => ({ value: l.id, label: l.name })) || []
    }
  })

  const { data: themes } = useQuery({
    queryKey: ['themes'],
    queryFn: async () => {
      const { data } = await supabase
        .from('themes')
        .select('id, name')
        .order('name')
      return data?.filter(t => t.name).map(t => ({ value: t.id, label: t.name })) || []
    }
  })

  const { data: portfolios } = useQuery({
    queryKey: ['portfolios'],
    queryFn: async () => {
      const { data } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')
      return data?.filter(p => p.name).map(p => ({ value: p.id, label: p.name })) || []
    }
  })

  const { data: analysts, isLoading: isLoadingAnalysts } = useQuery({
    queryKey: ['analysts-for-universe-wizard'],
    queryFn: async () => {
      console.log('Fetching analysts for universe filter...')
      // Get all analysts (not just active) for the dropdown - active filter is applied during preview
      const { data, error } = await supabase
        .from('coverage')
        .select('user_id, analyst_name')
        .not('analyst_name', 'is', null)
        .order('analyst_name')

      console.log('Analysts query result:', { data, error })

      if (error) {
        console.error('Error fetching analysts:', error)
        return []
      }

      // Get unique analysts with valid names
      const uniqueAnalysts = data?.reduce((acc: any[], curr) => {
        if (curr.analyst_name && curr.user_id && !acc.find(a => a.user_id === curr.user_id)) {
          acc.push(curr)
        }
        return acc
      }, []) || []

      const result = uniqueAnalysts.map(a => ({ value: a.user_id, label: a.analyst_name }))
      console.log('Analysts processed result:', result)
      return result
    },
    staleTime: 0 // Always refetch
  })

  // Calculate cadence days from timeframe
  const getCadenceDays = (timeframe: CadenceTimeframe): number => {
    const mapping: Record<CadenceTimeframe, number> = {
      daily: 1,
      weekly: 7,
      monthly: 30,
      quarterly: 90,
      'semi-annually': 180,
      annually: 365,
      persistent: 0
    }
    return mapping[timeframe]
  }

  // Validate current step
  const isStepValid = (step: number): boolean => {
    switch (step) {
      case 0: // Basic Info
        return basicInfo.name.trim().length > 0
      case 1: // Team - optional
        return true
      case 2: // Universe - optional
        return true
      case 3: // Stages
        return stages.length > 0 && stages.every(s => s.stage_label.trim().length > 0)
      case 4: // Automation - optional
        return true
      default:
        return true
    }
  }

  // Handle adding a team member
  const handleAddTeamMember = (userInfo: { id: string; email: string; name: string }) => {
    const newMember: TeamMember = {
      id: `temp_${Date.now()}`,
      userId: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      role: selectedRole
    }
    setTeam([...team, newMember])
    setUserSearchTerm('')
    setShowUserDropdown(false)
  }

  // Handle removing a team member
  const handleRemoveTeamMember = (memberId: string) => {
    setTeam(team.filter(t => t.id !== memberId))
  }

  // Handle toggling team member role
  const handleToggleRole = (memberId: string) => {
    setTeam(team.map(t =>
      t.id === memberId
        ? { ...t, role: t.role === 'admin' ? 'stakeholder' : 'admin' }
        : t
    ))
  }

  // Handle adding a stage
  const handleAddStage = () => {
    const newStage: WizardStage = {
      stage_key: `stage_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      stage_label: '',
      stage_description: '',
      stage_color: '#3b82f6',
      stage_icon: '',
      sort_order: stages.length + 1,
      standard_deadline_days: 7,
      suggested_priorities: []
    }
    setStages([...stages, newStage])
  }

  // Handle updating a stage
  const handleUpdateStage = (stageKey: string, updates: Partial<WizardStage>) => {
    setStages(stages.map(s =>
      s.stage_key === stageKey ? { ...s, ...updates } : s
    ))
  }

  // Handle removing a stage
  const handleRemoveStage = (stageKey: string) => {
    const newStages = stages.filter(s => s.stage_key !== stageKey)
    // Recalculate sort orders
    setStages(newStages.map((s, i) => ({ ...s, sort_order: i + 1 })))
  }

  // Get options for filter type
  const getOptionsForFilter = useCallback((type: string) => {
    console.log('getOptionsForFilter called with type:', type, 'analysts:', analysts, 'isLoadingAnalysts:', isLoadingAnalysts)
    switch (type) {
      case 'analyst':
        return analysts || []
      case 'list':
        return lists || []
      case 'theme':
        return themes || []
      case 'portfolio':
        return portfolios || []
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
      default:
        return []
    }
  }, [analysts, lists, themes, portfolios, isLoadingAnalysts])

  // Open filter modal for new filter
  const openNewFilterModal = (type: string) => {
    const definition = getFilterDefinition(type)
    setEditingFilter(null)
    setFilterType(type)
    setFilterOperator(definition?.defaultOperator || 'includes')
    setFilterValues(definition?.valueType === 'multi_select' ? [] : null)
    setFilterSearchTerm('')
    setShowFilterModal(true)
  }

  // Open filter modal for editing
  const openEditFilterModal = (filter: FilterRule) => {
    setEditingFilter(filter)
    setFilterType(filter.type)
    setFilterOperator(filter.operator)
    setFilterValues(filter.values)
    setFilterSearchTerm('')
    setShowFilterModal(true)
  }

  // Save filter
  const saveFilter = () => {
    if (!filterType || filterValues === null || (Array.isArray(filterValues) && filterValues.length === 0)) return

    const newFilter: FilterRule = {
      id: editingFilter?.id || `filter_${Date.now()}`,
      type: filterType,
      operator: filterOperator,
      values: filterValues
    }

    if (editingFilter) {
      // Update existing filter
      setFilters(filters.map(f => f.id === editingFilter.id ? newFilter : f))
    } else {
      // Add new filter
      setFilters([...filters, newFilter])
      // Add to logic expression with AND if not first filter
      if (logicExpression.length > 0) {
        setLogicExpression([
          ...logicExpression,
          { type: 'operator', value: 'AND' },
          { type: 'filter', filterId: newFilter.id }
        ])
      } else {
        setLogicExpression([{ type: 'filter', filterId: newFilter.id }])
      }
    }

    setShowFilterModal(false)
    setFilterType(null)
    setFilterValues(null)
  }

  // Delete a filter
  const deleteFilter = (filterId: string) => {
    setFilters(filters.filter(f => f.id !== filterId))
    // Remove from logic expression and clean up orphaned operators
    const newExpression = logicExpression.filter(token => {
      if (token.type === 'filter' && token.filterId === filterId) return false
      return true
    })
    // Clean up: remove consecutive operators and leading/trailing operators
    const cleaned = cleanLogicExpression(newExpression)
    setLogicExpression(cleaned)
  }

  // Clean up logic expression (remove orphaned operators, fix consecutive operators)
  const cleanLogicExpression = (expr: LogicToken[]): LogicToken[] => {
    const result: LogicToken[] = []
    let parenDepth = 0

    for (let i = 0; i < expr.length; i++) {
      const token = expr[i]
      const prev = result[result.length - 1]

      if (token.type === 'paren') {
        if (token.value === '(') {
          parenDepth++
          result.push(token)
        } else if (token.value === ')' && parenDepth > 0) {
          // Remove trailing operator before closing paren
          if (prev?.type === 'operator') result.pop()
          parenDepth--
          result.push(token)
        }
      } else if (token.type === 'operator') {
        // Don't add operator if previous is an operator, opening paren, or nothing
        if (prev && prev.type !== 'operator' && !(prev.type === 'paren' && prev.value === '(')) {
          result.push(token)
        }
      } else if (token.type === 'filter') {
        // Remove leading operator if this is first real token
        if (result.length === 0 || (result.length === 1 && result[0].type === 'paren')) {
          // Check if there's a leading operator to skip
        }
        // Don't add if previous is also a filter (missing operator)
        if (prev?.type === 'filter') {
          result.push({ type: 'operator', value: 'AND' })
        }
        result.push(token)
      }
    }

    // Remove trailing operators
    while (result.length > 0 && result[result.length - 1].type === 'operator') {
      result.pop()
    }

    // Remove leading operators
    while (result.length > 0 && result[0].type === 'operator') {
      result.shift()
    }

    return result
  }

  // Add parentheses around selected filters in logic expression
  const wrapInParentheses = (startIndex: number, endIndex: number) => {
    const newExpr = [...logicExpression]
    newExpr.splice(endIndex + 1, 0, { type: 'paren', value: ')' })
    newExpr.splice(startIndex, 0, { type: 'paren', value: '(' })
    setLogicExpression(newExpr)
  }

  // Toggle operator in logic expression
  const toggleOperator = (index: number) => {
    const token = logicExpression[index]
    if (token.type === 'operator') {
      const newExpr = [...logicExpression]
      newExpr[index] = { type: 'operator', value: token.value === 'AND' ? 'OR' : 'AND' }
      setLogicExpression(newExpr)
    }
  }

  // Remove parentheses pair
  const removeParentheses = (openIndex: number) => {
    const token = logicExpression[openIndex]
    // Make sure we're clicking on an opening paren
    if (token?.type !== 'paren' || token?.value !== '(') {
      console.log('Not an opening paren:', token)
      return
    }

    // Find matching close paren
    let depth = 1
    let closeIndex = -1
    for (let i = openIndex + 1; i < logicExpression.length; i++) {
      const t = logicExpression[i]
      if (t.type === 'paren') {
        if (t.value === '(') {
          depth++
        } else if (t.value === ')') {
          depth--
          if (depth === 0) {
            closeIndex = i
            break
          }
        }
      }
    }

    if (closeIndex > -1) {
      // Remove both parens - remove higher index first to preserve lower index
      const newExpr = logicExpression.filter((_, i) => i !== openIndex && i !== closeIndex)
      setLogicExpression(newExpr)
      setSelectedTokens(new Set())
    }
  }

  // Toggle token selection
  const toggleTokenSelection = (index: number) => {
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
    if (selectedTokens.size < 2) return

    const indices = Array.from(selectedTokens).sort((a, b) => a - b)
    const minIndex = indices[0]
    const maxIndex = indices[indices.length - 1]

    // Insert parens around the selection
    const newExpr = [...logicExpression]
    newExpr.splice(maxIndex + 1, 0, { type: 'paren', value: ')' })
    newExpr.splice(minIndex, 0, { type: 'paren', value: '(' })

    setLogicExpression(newExpr)
    setSelectedTokens(new Set())
  }

  // Clear selection
  const clearSelection = () => {
    setSelectedTokens(new Set())
  }

  // Format filter value for compact display
  const formatFilterValue = (rule: FilterRule): string => {
    const options = getOptionsForFilter(rule.type)
    if (Array.isArray(rule.values)) {
      if (rule.values.length <= 2) {
        return rule.values.map(v => {
          const opt = options.find(o => o.value === v)
          return opt?.label || v
        }).join(', ')
      }
      const first = options.find(o => o.value === rule.values[0])?.label || rule.values[0]
      return `${first} +${rule.values.length - 1} more`
    }
    const opt = options.find(o => o.value === rule.values)
    return opt?.label || String(rule.values)
  }

  // Get filter by ID
  const getFilterById = (id: string) => filters.find(f => f.id === id)

  // Fetch asset IDs for a single filter
  const fetchFilterAssetIds = async (filter: FilterRule): Promise<Set<string>> => {
    const isExclude = filter.operator === 'excludes'
    let filterAssetIds: string[] = []

    switch (filter.type) {
      case 'sector':
        if (Array.isArray(filter.values) && filter.values.length > 0) {
          const { data: sectorAssets } = await supabase
            .from('assets')
            .select('id')
            .in('sector', filter.values)
          filterAssetIds = sectorAssets?.map(a => a.id) || []
        }
        break

      case 'analyst':
        if (Array.isArray(filter.values) && filter.values.length > 0) {
          const { data: coverageData } = await supabase
            .from('coverage')
            .select('asset_id')
            .in('user_id', filter.values)
            .eq('is_active', true)
          filterAssetIds = coverageData?.map(c => c.asset_id).filter(Boolean) || []
        }
        break

      case 'list':
        if (Array.isArray(filter.values) && filter.values.length > 0) {
          const { data: listAssets } = await supabase
            .from('asset_list_items')
            .select('asset_id')
            .in('list_id', filter.values)
          filterAssetIds = listAssets?.map(l => l.asset_id).filter(Boolean) || []
        }
        break

      case 'theme':
        if (Array.isArray(filter.values) && filter.values.length > 0) {
          const { data: themeAssets } = await supabase
            .from('theme_assets')
            .select('asset_id')
            .in('theme_id', filter.values)
          filterAssetIds = themeAssets?.map(t => t.asset_id).filter(Boolean) || []
        }
        break

      case 'portfolio':
        if (Array.isArray(filter.values) && filter.values.length > 0) {
          const { data: portfolioCoverage } = await supabase
            .from('coverage')
            .select('asset_id')
            .in('portfolio_id', filter.values)
            .eq('is_active', true)
          filterAssetIds = portfolioCoverage?.map(p => p.asset_id).filter(Boolean) || []
        }
        break
    }

    // Handle excludes by getting all assets and removing the matched ones
    if (isExclude) {
      const { data: allAssets } = await supabase.from('assets').select('id')
      const allIds = new Set(allAssets?.map(a => a.id) || [])
      filterAssetIds.forEach(id => allIds.delete(id))
      return allIds
    }

    return new Set(filterAssetIds)
  }

  // Evaluate the logic expression to get matching asset IDs
  const evaluateLogicExpression = async (): Promise<Set<string>> => {
    // If no logic expression or only one filter, just get the filter results
    if (logicExpression.length === 0) {
      if (filters.length === 1) {
        return await fetchFilterAssetIds(filters[0])
      }
      return new Set()
    }

    // Pre-fetch all filter results
    const filterResults: Record<string, Set<string>> = {}
    for (const filter of filters) {
      filterResults[filter.id] = await fetchFilterAssetIds(filter)
    }

    // Parse and evaluate the expression using a stack-based approach
    const valueStack: Set<string>[] = []
    const operatorStack: ('AND' | 'OR')[] = []

    const applyOperator = () => {
      if (valueStack.length < 2 || operatorStack.length === 0) return
      const right = valueStack.pop()!
      const left = valueStack.pop()!
      const op = operatorStack.pop()!

      if (op === 'AND') {
        // Intersection
        valueStack.push(new Set([...left].filter(id => right.has(id))))
      } else {
        // Union
        valueStack.push(new Set([...left, ...right]))
      }
    }

    for (const token of logicExpression) {
      if (token.type === 'filter') {
        const result = filterResults[token.filterId]
        if (result) {
          valueStack.push(result)
          // Apply pending operator if we have two values
          while (valueStack.length >= 2 && operatorStack.length > 0) {
            applyOperator()
          }
        }
      } else if (token.type === 'operator') {
        operatorStack.push(token.value)
      } else if (token.type === 'paren') {
        // For simplicity, parentheses are handled by the order of operations
        // The logic expression is already structured with parentheses affecting grouping
        // This basic implementation treats it as left-to-right evaluation
        // A full implementation would need recursive parsing
      }
    }

    // Apply any remaining operators
    while (operatorStack.length > 0 && valueStack.length >= 2) {
      applyOperator()
    }

    return valueStack.length > 0 ? valueStack[0] : new Set()
  }

  // Fetch preview of matching assets
  const fetchPreviewAssets = async () => {
    if (filters.length === 0) {
      setPreviewError('No filters defined - all assets would be eligible')
      setPreviewAssets([])
      setShowPreviewModal(true)
      return
    }

    setIsLoadingPreview(true)
    setPreviewError(null)
    setShowPreviewModal(true)

    console.log('Fetching preview for filters:', filters)
    console.log('Logic expression:', logicExpression)

    try {
      // Evaluate the logic expression
      const matchingAssetIds = await evaluateLogicExpression()
      console.log('Matching asset IDs:', matchingAssetIds.size)

      // Fetch the actual asset details
      if (matchingAssetIds.size > 0) {
        const idsArray = Array.from(matchingAssetIds).slice(0, 100)
        console.log('Fetching asset details for IDs:', idsArray.length)
        const { data, error } = await supabase
          .from('assets')
          .select('id, symbol, company_name, sector')
          .in('id', idsArray)
          .order('symbol')

        if (error) throw error
        console.log('Final assets:', data?.length)
        setPreviewAssets(data || [])
      } else {
        console.log('No matching assets found')
        setPreviewAssets([])
      }
    } catch (error: any) {
      console.error('Error fetching preview:', error)
      setPreviewError(error.message || 'Failed to fetch preview')
      setPreviewAssets([])
    } finally {
      setIsLoadingPreview(false)
    }
  }

  // Open automation rule modal for branch creation
  const openBranchRuleModal = () => {
    setShowBranchRuleModal(true)
  }

  // Open automation rule modal for asset population
  const openAssetRuleModal = () => {
    setShowAssetRuleModal(true)
  }

  // Save branch creation rule from AddRuleModal
  const handleSaveBranchRule = (ruleData: any) => {
    const newRule: AutomationRuleData = {
      id: `rule_${Date.now()}`,
      name: ruleData.name,
      type: ruleData.type,
      conditionType: ruleData.conditionType,
      conditionValue: ruleData.conditionValue,
      actionType: ruleData.actionType,
      actionValue: ruleData.actionValue,
      isActive: ruleData.isActive,
      rule_category: 'branch_creation'
    }
    setAutomationRules([...automationRules, newRule])
    setShowBranchRuleModal(false)
  }

  // Save asset population rule from AddAssetPopulationRuleModal
  const handleSaveAssetRule = (ruleData: any) => {
    const newRule: AutomationRuleData = {
      id: `rule_${Date.now()}`,
      name: ruleData.name,
      type: ruleData.type || 'event',
      conditionType: ruleData.conditionType,
      conditionValue: ruleData.conditionValue,
      actionType: ruleData.actionType,
      actionValue: ruleData.actionValue,
      isActive: ruleData.isActive,
      rule_category: 'asset_population'
    }
    setAutomationRules([...automationRules, newRule])
    setShowAssetRuleModal(false)
  }

  // Create the workflow
  const handleSubmit = async () => {
    if (!user) return

    setIsSubmitting(true)
    try {
      // 1. Create the workflow
      const { data: workflow, error: workflowError } = await supabase
        .from('workflows')
        .insert({
          name: basicInfo.name,
          description: basicInfo.description,
          color: basicInfo.color,
          is_public: false, // Always private, access is based on team
          cadence_timeframe: basicInfo.cadence_timeframe,
          cadence_days: getCadenceDays(basicInfo.cadence_timeframe),
          created_by: user.id
        })
        .select()
        .single()

      if (workflowError) throw workflowError

      const workflowId = workflow.id

      // 2. Create initial template version
      await supabase.rpc('create_initial_template_version', {
        p_workflow_id: workflowId
      })

      // 3. Add stages
      if (stages.length > 0) {
        const stagesData = stages.map(s => ({
          workflow_id: workflowId,
          stage_key: s.stage_key,
          stage_label: s.stage_label,
          stage_description: s.stage_description,
          stage_color: s.stage_color,
          stage_icon: s.stage_icon,
          sort_order: s.sort_order,
          standard_deadline_days: s.standard_deadline_days,
          suggested_priorities: s.suggested_priorities
        }))

        const { error: stagesError } = await supabase
          .from('workflow_stages')
          .insert(stagesData)

        if (stagesError) throw stagesError
      }

      // 4. Add team members (admins as collaborators, stakeholders to stakeholders table)
      const admins = team.filter(t => t.role === 'admin')
      const stakeholders = team.filter(t => t.role === 'stakeholder')

      if (admins.length > 0) {
        const collaboratorsData = admins.map(a => ({
          workflow_id: workflowId,
          user_id: a.userId,
          permission: 'admin'
        }))

        const { error: collabError } = await supabase
          .from('workflow_collaborations')
          .insert(collaboratorsData)

        if (collabError) throw collabError
      }

      if (stakeholders.length > 0) {
        const stakeholdersData = stakeholders.map(s => ({
          workflow_id: workflowId,
          user_id: s.userId
        }))

        const { error: stakeholderError } = await supabase
          .from('workflow_stakeholders')
          .insert(stakeholdersData)

        if (stakeholderError) throw stakeholderError
      }

      // 5. Add universe rules with logic expression
      if (filters.length > 0) {
        const rulesData = filters.map((filter, index) => ({
          workflow_id: workflowId,
          rule_type: filter.type,
          rule_config: {
            operator: filter.operator,
            values: filter.values,
            filter_id: filter.id
          },
          combination_operator: 'or', // Default, actual logic is in logic_expression
          sort_order: index,
          is_active: true,
          description: '' // Store logic expression in workflow metadata instead
        }))

        const { error: rulesError } = await supabase
          .from('workflow_universe_rules')
          .insert(rulesData)

        if (rulesError) throw rulesError

        // Store logic expression in workflow metadata
        if (logicExpression.length > 0) {
          const { error: metaError } = await supabase
            .from('workflows')
            .update({
              metadata: {
                universe_logic_expression: logicExpression
              }
            })
            .eq('id', workflowId)

          if (metaError) throw metaError
        }
      }

      // 6. Add automation rules
      if (automationRules.length > 0) {
        const autoRulesData = automationRules.map(r => ({
          workflow_id: workflowId,
          rule_name: r.name,
          rule_type: r.type,
          rule_category: r.rule_category,
          condition_type: r.conditionType,
          condition_value: r.conditionValue,
          action_type: r.actionType,
          action_value: r.actionValue,
          is_active: r.isActive
        }))

        const { error: autoError } = await supabase
          .from('workflow_automation_rules')
          .insert(autoRulesData)

        if (autoError) throw autoError
      }

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      queryClient.invalidateQueries({ queryKey: ['my-workflows'] })

      // Complete
      onComplete(workflowId)
    } catch (error) {
      console.error('Error creating workflow:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return renderBasicInfoStep()
      case 1:
        return renderTeamStep()
      case 2:
        return renderUniverseStep()
      case 3:
        return renderStagesStep()
      case 4:
        return renderAutomationStep()
      default:
        return null
    }
  }

  // Step 1: Basic Info
  const renderBasicInfoStep = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Workflow Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={basicInfo.name}
          onChange={(e) => setBasicInfo({ ...basicInfo, name: e.target.value })}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
          placeholder="e.g., Quarterly Earnings Review"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Description
        </label>
        <textarea
          value={basicInfo.description}
          onChange={(e) => setBasicInfo({ ...basicInfo, description: e.target.value })}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
          rows={3}
          placeholder="Describe the purpose and goals of this workflow..."
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Color
          </label>
          <div className="flex items-center space-x-3">
            <input
              type="color"
              value={basicInfo.color}
              onChange={(e) => setBasicInfo({ ...basicInfo, color: e.target.value })}
              className="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer"
            />
            <input
              type="text"
              value={basicInfo.color}
              onChange={(e) => setBasicInfo({ ...basicInfo, color: e.target.value })}
              className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Cadence
          </label>
          <select
            value={basicInfo.cadence_timeframe}
            onChange={(e) => setBasicInfo({ ...basicInfo, cadence_timeframe: e.target.value as CadenceTimeframe })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          >
            {CADENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} - {option.description}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )

  // Step 2: Team
  const renderTeamStep = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Team Members</h3>
          <p className="text-sm text-gray-500">Add admins and stakeholders to this workflow</p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-500">Add as:</span>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value as 'admin' | 'stakeholder')}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          >
            <option value="admin">Admin</option>
            <option value="stakeholder">Stakeholder</option>
          </select>
        </div>
      </div>

      {/* User Search */}
      <div className="relative">
        <div className="flex items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={userSearchTerm}
              onChange={(e) => {
                setUserSearchTerm(e.target.value)
                setShowUserDropdown(true)
              }}
              onFocus={() => setShowUserDropdown(true)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Search users by name or email..."
            />
          </div>
        </div>

        {showUserDropdown && filteredUsers.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {filteredUsers.slice(0, 10).map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => handleAddTeamMember(u)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0"
              >
                <div className="font-medium text-sm text-gray-900">{u.name}</div>
                <div className="text-xs text-gray-500">{u.email}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Team List */}
      {team.length > 0 ? (
        <div className="space-y-2">
          {team.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  member.role === 'admin' ? 'bg-blue-100' : 'bg-green-100'
                }`}>
                  <span className={`font-semibold text-sm ${
                    member.role === 'admin' ? 'text-blue-700' : 'text-green-700'
                  }`}>
                    {member.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="font-medium text-gray-900">{member.name}</div>
                  <div className="text-sm text-gray-500">{member.email}</div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => handleToggleRole(member.id)}
                  className="cursor-pointer"
                  title="Click to change role"
                >
                  <Badge
                    variant={member.role === 'admin' ? 'default' : 'success'}
                    className="cursor-pointer hover:opacity-80"
                  >
                    {member.role === 'admin' ? 'Admin' : 'Stakeholder'}
                  </Badge>
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveTeamMember(member.id)}
                  className="text-gray-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center border-2 border-dashed border-gray-300">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">No Team Members Yet</h4>
          <p className="text-sm text-gray-500">
            You can add team members now or after creating the workflow
          </p>
        </Card>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Role Differences (click badge to change):</p>
            <ul className="list-disc list-inside space-y-1 text-blue-700">
              <li><strong>Admins</strong> can edit workflow settings, stages, and manage team</li>
              <li><strong>Stakeholders</strong> receive notifications and can view workflow progress</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )

  // Step 3: Universe
  const renderUniverseStep = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Universe Rules</h3>
        <p className="text-sm text-gray-500">Define which assets are eligible for this workflow</p>
      </div>

      {/* Add Filter Section - Now at Top */}
      <div className={`${filters.length === 0 ? 'p-6 border-2 border-dashed border-gray-300 rounded-lg' : ''}`}>
        <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2`}>
          {['analyst', 'list', 'theme', 'portfolio', 'sector'].map((ft) => {
            const definition = getFilterDefinition(ft)
            if (!definition) return null
            const Icon = definition.icon

            return (
              <button
                key={ft}
                type="button"
                onClick={() => openNewFilterModal(ft)}
                className="flex items-center space-x-2 p-2.5 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                <Icon className="w-4 h-4 text-gray-500" />
                <span className="font-medium text-gray-700 text-sm">{definition.name}</span>
              </button>
            )
          })}
        </div>
        {filters.length === 0 && (
          <div className="text-center mt-4">
            <Filter className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No filters defined - all assets will be eligible</p>
          </div>
        )}
      </div>

      {/* Logic Builder Section - Only show when there are 2+ filters */}
      {filters.length >= 2 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-700">Filter Logic</h4>
            <div className="flex items-center gap-2">
              {selectedTokens.size >= 2 && (
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
              {selectedTokens.size < 2 && selectedTokens.size > 0 && (
                <span className="text-xs text-gray-500">Select more to group</span>
              )}
            </div>
          </div>

          {/* Logic Expression Display */}
          <div className="flex flex-wrap items-center gap-1.5 p-3 bg-white border border-gray-200 rounded-lg min-h-[48px]">
            {logicExpression.map((token, index) => {
              const isSelected = selectedTokens.has(index)

              if (token.type === 'filter') {
                const filter = getFilterById(token.filterId)
                if (!filter) return null
                const def = getFilterDefinition(filter.type)
                const fullDetails = `${def?.name || filter.type} ${OPERATOR_LABELS[filter.operator]} ${formatFilterValue(filter)}`
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => toggleTokenSelection(index)}
                    className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-purple-200 text-purple-900 ring-2 ring-purple-400'
                        : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                    }`}
                    title={fullDetails}
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
                      if (e.shiftKey) {
                        toggleTokenSelection(index)
                      } else {
                        toggleOperator(index)
                      }
                    }}
                    className={`px-2 py-1 rounded text-xs font-bold cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-purple-200 text-purple-900 ring-2 ring-purple-400'
                        : token.value === 'AND'
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                    }`}
                    title="Click to toggle AND/OR, Shift+Click to select"
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
                      e.preventDefault()
                      e.stopPropagation()
                      if (isOpenParen) {
                        removeParentheses(index)
                      } else {
                        // Find matching opening paren for this closing paren
                        let depth = 1
                        for (let i = index - 1; i >= 0; i--) {
                          const t = logicExpression[i]
                          if (t.type === 'paren') {
                            if (t.value === ')') {
                              depth++
                            } else if (t.value === '(') {
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
                    className="font-bold text-lg px-0.5 transition-colors text-purple-600 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer"
                    title="Click to remove this ( ) pair"
                  >
                    {token.value}
                  </button>
                )
              }
              return null
            })}
          </div>

          <p className="text-xs text-gray-500 mt-2">
            Click filters to select, then "Group Selected" to add parentheses • Click <span className="font-bold text-purple-600">( )</span> to remove group • Click <span className="text-green-600 font-medium">AND</span>/<span className="text-orange-600 font-medium">OR</span> to toggle
          </p>
        </div>
      )}

      {/* Filters List - Now at Bottom */}
      {filters.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-700">Added Filters ({filters.length})</h4>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchPreviewAssets}
            >
              <Eye className="w-4 h-4 mr-1" />
              Preview Matching Assets
            </Button>
          </div>
          <div className="space-y-2">
            {filters.map((filter) => {
              const definition = getFilterDefinition(filter.type)
              if (!definition) return null

              return (
                <div
                  key={filter.id}
                  className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:border-gray-300"
                >
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-2">
                      <Badge variant="secondary">{definition.name}</Badge>
                      <span className={`text-sm ${filter.operator === 'excludes' ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {OPERATOR_LABELS[filter.operator]}
                      </span>
                    </div>
                    <span className="text-sm text-gray-900">
                      {formatFilterValue(filter)}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => openEditFilterModal(filter)}
                      className="text-gray-400 hover:text-blue-600 p-1"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteFilter(filter.id)}
                      className="text-gray-400 hover:text-red-600 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filter Modal */}
      {showFilterModal && filterType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingFilter ? 'Edit Filter' : 'Add Filter'}: {getFilterDefinition(filterType)?.name}
              </h3>
              <button onClick={() => setShowFilterModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Operator Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Condition</label>
                <div className="flex space-x-2">
                  {getFilterDefinition(filterType)?.availableOperators.map((op) => (
                    <button
                      key={op}
                      type="button"
                      onClick={() => setFilterOperator(op)}
                      className={`px-4 py-2 rounded-lg border text-sm font-medium ${
                        filterOperator === op
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {OPERATOR_LABELS[op]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Value Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Values</label>
                <input
                  type="text"
                  placeholder="Search..."
                  value={filterSearchTerm}
                  onChange={(e) => setFilterSearchTerm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2"
                />
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                  {getOptionsForFilter(filterType)
                    .filter(opt => opt.label && opt.label.toLowerCase().includes(filterSearchTerm.toLowerCase()))
                    .map((option) => (
                      <label
                        key={option.value}
                        className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={Array.isArray(filterValues) && filterValues.includes(option.value)}
                          onChange={(e) => {
                            const currentValues = Array.isArray(filterValues) ? filterValues : []
                            if (e.target.checked) {
                              setFilterValues([...currentValues, option.value])
                            } else {
                              setFilterValues(currentValues.filter(v => v !== option.value))
                            }
                          }}
                          className="rounded text-blue-600"
                        />
                        <span className="text-sm text-gray-700">{option.label}</span>
                      </label>
                    ))}
                </div>
                {Array.isArray(filterValues) && filterValues.length > 0 && (
                  <p className="text-sm text-gray-500 mt-2">{filterValues.length} selected</p>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <Button variant="outline" onClick={() => setShowFilterModal(false)}>Cancel</Button>
              <Button
                onClick={saveFilter}
                disabled={!Array.isArray(filterValues) || filterValues.length === 0}
              >
                {editingFilter ? 'Update' : 'Add'} Filter
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Preview Matching Assets</h3>
                <p className="text-sm text-gray-500">
                  {isLoadingPreview ? 'Loading...' : previewAssets.length > 0 ? `${previewAssets.length}${previewAssets.length === 100 ? '+' : ''} assets match your criteria` : 'No matching assets'}
                </p>
              </div>
              <button onClick={() => setShowPreviewModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {isLoadingPreview ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                  <span className="ml-3 text-gray-600">Fetching matching assets...</span>
                </div>
              ) : previewError ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800">{previewError}</div>
                  </div>
                </div>
              ) : previewAssets.length === 0 ? (
                <div className="text-center py-12">
                  <Filter className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <h4 className="text-lg font-medium text-gray-900 mb-2">No Matching Assets</h4>
                  <p className="text-sm text-gray-500">No assets match your current filter criteria</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-100 rounded-t-lg text-xs font-medium text-gray-600 uppercase tracking-wide">
                    <div className="col-span-2">Symbol</div>
                    <div className="col-span-7">Company Name</div>
                    <div className="col-span-3">Sector</div>
                  </div>
                  <div className="divide-y divide-gray-100 border border-gray-200 rounded-b-lg max-h-[400px] overflow-y-auto">
                    {previewAssets.map((asset) => (
                      <div key={asset.id} className="grid grid-cols-12 gap-2 px-3 py-2.5 hover:bg-gray-50 text-sm">
                        <div className="col-span-2 font-medium text-gray-900">{asset.symbol}</div>
                        <div className="col-span-7 text-gray-700 truncate" title={asset.company_name}>{asset.company_name}</div>
                        <div className="col-span-3 text-gray-500 truncate">{asset.sector || '-'}</div>
                      </div>
                    ))}
                  </div>
                  {previewAssets.length === 100 && (
                    <p className="text-xs text-gray-500 text-center mt-3">
                      Showing first 100 results. More assets may match your criteria.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <Button variant="outline" onClick={() => setShowPreviewModal(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // Step 4: Stages
  const renderStagesStep = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Workflow Stages</h3>
          <p className="text-sm text-gray-500">Define the stages assets will progress through</p>
        </div>
        <Button size="sm" onClick={handleAddStage}>
          <Plus className="w-4 h-4 mr-1" />
          Add Stage
        </Button>
      </div>

      {stages.length > 0 ? (
        <div className="space-y-3">
          {stages.map((stage, index) => (
            <div
              key={stage.stage_key}
              className="p-4 bg-white border-2 border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start space-x-4">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 font-semibold text-sm flex-shrink-0">
                  {index + 1}
                </div>
                <div className="flex-1 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Stage Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={stage.stage_label}
                        onChange={(e) => handleUpdateStage(stage.stage_key, { stage_label: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        placeholder="e.g., Research"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Deadline (days)
                      </label>
                      <input
                        type="number"
                        value={stage.standard_deadline_days}
                        onChange={(e) => handleUpdateStage(stage.stage_key, { standard_deadline_days: parseInt(e.target.value) || 7 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        min="1"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      value={stage.stage_description}
                      onChange={(e) => handleUpdateStage(stage.stage_key, { stage_description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      placeholder="What happens in this stage?"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveStage(stage.stage_key)}
                  className="text-gray-400 hover:text-red-600 transition-colors p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-8 text-center border-2 border-dashed border-gray-300 rounded-lg">
          <Layers className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">No Stages Defined</h4>
          <p className="text-sm text-gray-500">Use the "Add Stage" button above to add stages to your workflow</p>
        </div>
      )}

      {stages.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p>You need at least one stage to create a workflow.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // Step 5: Automation
  const renderAutomationStep = () => {
    const branchRules = automationRules.filter(r => r.rule_category === 'branch_creation')
    const assetRules = automationRules.filter(r => r.rule_category === 'asset_population')

    // Helper to get rule description
    const getRuleDescription = (rule: AutomationRuleData) => {
      // Time-based triggers
      if (rule.type === 'time') {
        const cv = rule.conditionValue
        if (cv?.pattern_type === 'daily') {
          return cv.daily_type === 'every_weekday' ? 'Every weekday' : `Every ${cv.interval || 1} day(s)`
        }
        if (cv?.pattern_type === 'weekly') {
          const days = cv.days_of_week?.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')
          return `Every ${cv.interval || 1} week(s) on ${days || 'Mon'}`
        }
        if (cv?.pattern_type === 'monthly') {
          return cv.monthly_type === 'day_of_month'
            ? `Day ${cv.day_number || 1} of every ${cv.interval || 1} month(s)`
            : `${cv.position || 'First'} ${cv.day_name || 'Monday'} of every ${cv.interval || 1} month(s)`
        }
        if (cv?.pattern_type === 'quarterly') {
          return `Every ${cv.interval || 1} quarter(s)`
        }
        if (cv?.pattern_type === 'yearly') {
          return `Yearly on ${cv.month || 'January'} ${cv.day_number || 1}`
        }
        return 'Time-based trigger'
      }

      // Event-based triggers
      if (rule.type === 'event') {
        if (rule.conditionType === 'earnings_date') {
          const timing = rule.conditionValue?.timing || 'before'
          const days = rule.conditionValue?.days_offset || 0
          return `${days} days ${timing} earnings`
        }
        if (rule.conditionType === 'price_change') {
          return `Price ${rule.conditionValue?.direction || 'change'} ${rule.conditionValue?.percentage || 0}%`
        }
        if (rule.conditionType === 'volume_spike') {
          return `Volume ${rule.conditionValue?.multiplier || 2}× average`
        }
        if (rule.conditionType === 'dividend_date') {
          return `${rule.conditionValue?.days_offset || 0} days ${rule.conditionValue?.timing || 'before'} dividend`
        }
        return rule.conditionType.replace(/_/g, ' ')
      }

      // Activity triggers
      if (rule.type === 'activity') {
        return rule.conditionType.replace(/_/g, ' ')
      }

      // Perpetual
      if (rule.type === 'perpetual') {
        return 'Always available'
      }

      // Asset population rules
      if (rule.conditionType === 'on_branch_creation') return 'On branch creation'
      if (rule.conditionType === 'days_before_earnings') return `${rule.conditionValue?.days_offset || 0} days before earnings`
      if (rule.conditionType === 'days_after_earnings') return `${rule.conditionValue?.days_offset || 0} days after earnings`
      if (rule.conditionType === 'manual_trigger') return 'Manual only'

      return rule.conditionType
    }

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Automation Rules</h3>
          <p className="text-sm text-gray-500">Configure when branches are created and assets are added</p>
        </div>

        {/* Branch Creation Rules */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <GitBranch className="w-5 h-5 text-purple-600" />
              <div>
                <h4 className="font-medium text-gray-900">Branch Creation Rules</h4>
                <p className="text-sm text-gray-500">When to create new workflow branches</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={openBranchRuleModal}>
              <Plus className="w-4 h-4 mr-1" />
              Add Rule
            </Button>
          </div>

          {branchRules.length > 0 ? (
            <div className="space-y-2">
              {branchRules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between p-3 bg-purple-50 rounded-lg border border-purple-200">
                  <div>
                    <div className="font-medium text-purple-900">{rule.name}</div>
                    <div className="text-sm text-purple-700">
                      {getRuleDescription(rule)}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setAutomationRules(automationRules.filter(r => r.id !== rule.id))}
                      className="text-purple-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">No branch creation rules defined</p>
          )}
        </Card>

        {/* Asset Population Rules */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Users className="w-5 h-5 text-orange-600" />
              <div>
                <h4 className="font-medium text-gray-900">Asset Population Rules</h4>
                <p className="text-sm text-gray-500">When to add assets to branches</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={openAssetRuleModal}>
              <Plus className="w-4 h-4 mr-1" />
              Add Rule
            </Button>
          </div>

          {assetRules.length > 0 ? (
            <div className="space-y-2">
              {assetRules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between p-3 bg-orange-50 rounded-lg border border-orange-200">
                  <div>
                    <div className="font-medium text-orange-900">{rule.name}</div>
                    <div className="text-sm text-orange-700">
                      {getRuleDescription(rule)}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setAutomationRules(automationRules.filter(r => r.id !== rule.id))}
                      className="text-orange-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">No asset population rules defined</p>
          )}
        </Card>

        {/* Branch Creation Rule Modal */}
        {showBranchRuleModal && (
          <AddRuleModal
            workflowId=""
            workflowName={basicInfo.name || 'New Workflow'}
            workflowStages={stages}
            cadenceTimeframe={basicInfo.cadence_timeframe}
            onClose={() => setShowBranchRuleModal(false)}
            onSave={handleSaveBranchRule}
          />
        )}

        {/* Asset Population Rule Modal */}
        {showAssetRuleModal && (
          <AddAssetPopulationRuleModal
            workflowId=""
            workflowName={basicInfo.name || 'New Workflow'}
            workflowStages={stages}
            onClose={() => setShowAssetRuleModal(false)}
            onSave={handleSaveAssetRule}
          />
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-x-0 top-24 bottom-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[calc(100vh-10rem)] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Create New Workflow</h2>
            <p className="text-sm text-gray-500 mt-1">Step {currentStep + 1} of {STEPS.length}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex-shrink-0">
          <div className="flex items-center justify-between">
            {STEPS.map((step, index) => {
              const Icon = step.icon
              const isActive = index === currentStep
              const isCompleted = index < currentStep
              const isValid = isStepValid(index)

              return (
                <React.Fragment key={step.id}>
                  <button
                    type="button"
                    onClick={() => {
                      // Allow navigation to previous steps or completed steps
                      if (index < currentStep || (index <= currentStep && isValid)) {
                        setCurrentStep(index)
                      }
                    }}
                    disabled={index > currentStep && !isStepValid(currentStep)}
                    className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-all ${
                      isActive
                        ? 'bg-blue-100 text-blue-700'
                        : isCompleted
                          ? 'bg-green-50 text-green-700 hover:bg-green-100'
                          : 'text-gray-400 hover:text-gray-600'
                    } ${index > currentStep ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : isCompleted
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-200 text-gray-500'
                    }`}>
                      {isCompleted ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </div>
                    <div className="hidden sm:block text-left">
                      <div className="text-sm font-medium">{step.label}</div>
                      <div className="text-xs opacity-75">{step.description}</div>
                    </div>
                  </button>
                  {index < STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 ${
                      index < currentStep ? 'bg-green-500' : 'bg-gray-200'
                    }`} />
                  )}
                </React.Fragment>
              )
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderStepContent()}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between flex-shrink-0 bg-gray-50">
          <Button
            variant="outline"
            onClick={() => currentStep > 0 ? setCurrentStep(currentStep - 1) : onClose()}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            {currentStep === 0 ? 'Cancel' : 'Back'}
          </Button>

          <div className="flex items-center space-x-3">
            {currentStep < STEPS.length - 1 ? (
              <Button
                onClick={() => setCurrentStep(currentStep + 1)}
                disabled={!isStepValid(currentStep)}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !isStepValid(currentStep) || stages.length === 0}
              >
                {isSubmitting ? (
                  <>
                    <span className="animate-spin mr-2">⏳</span>
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-1" />
                    Create Workflow
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
