/**
 * CreateWorkflowWizard Component
 *
 * Multi-step wizard for creating a new workflow template.
 * Walks users through all setup options to ensure version 1.0 is usable:
 * 1. Basics (name, description, scope, appearance)
 * 2. Access (team & admins)
 * 3. Scope (asset/portfolio eligibility rules)
 * 4. Workflow (stages)
 * 5. Rules (automation & triggers)
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ArrowLeft,
  Palette,
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
  Loader2,
  Briefcase,
  ClipboardList,
  BarChart3,
  XCircle,
  Lock,
  Info,
  GripVertical,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { CadenceTimeframe, WorkflowScopeType } from '../../types/workflow'
import {
  FILTER_TYPE_REGISTRY,
  OPERATOR_LABELS,
  getFilterDefinition,
  FilterOperator
} from '../../lib/universeFilters'
import { AddRuleModal } from './modals/AddRuleModal'
import { AddAssetPopulationRuleModal } from './modals/AddAssetPopulationRuleModal'
import { AddBranchEndingRuleModal } from './modals/AddBranchEndingRuleModal'

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
  checklist_items: string[]
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
  rule_category: 'branch_creation' | 'asset_population' | 'branch_ending'
}

interface CreateWorkflowWizardProps {
  onClose: () => void
  onComplete: (workflowId: string) => void
}

// Step definitions — dynamic based on scope type
function getSteps(scopeType: WorkflowScopeType) {
  const base = [
    { id: 'basic', label: 'Foundation', icon: FileText, description: 'Name and scope' },
    { id: 'team', label: 'Access', icon: Users, description: 'Governance & roles' },
  ]
  if (scopeType === 'asset') {
    base.push({ id: 'universe', label: 'Scope', icon: Filter, description: 'Asset eligibility' })
  } else if (scopeType === 'portfolio') {
    base.push({ id: 'portfolios', label: 'Scope', icon: Briefcase, description: 'Select portfolios' })
  }
  // general: no universe/portfolio step
  base.push(
    { id: 'stages', label: 'Workflow', icon: Layers, description: 'Design stages' },
    { id: 'automation', label: 'Rules', icon: Zap, description: 'Triggers & automation' },
  )
  return base
}

// Scope options for the picker
const SCOPE_OPTIONS: { value: WorkflowScopeType; label: string; description: string; icon: typeof BarChart3 }[] = [
  { value: 'asset', label: 'Assets', description: 'Track each asset independently through defined stages', icon: BarChart3 },
  { value: 'portfolio', label: 'Portfolios', description: 'Track each portfolio independently through defined stages', icon: Briefcase },
  { value: 'general', label: 'Standalone', description: 'Runs progress independently through defined stages', icon: ClipboardList },
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
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Ref to prevent multiple submissions (handles race conditions)
  const isSubmittingRef = useRef(false)

  // Scope type (locked after creation)
  const [scopeType, setScopeType] = useState<WorkflowScopeType>('asset')
  const [descExpanded, setDescExpanded] = useState(false)
  const [continueAttempted, setContinueAttempted] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const STEPS = getSteps(scopeType)

  // Form state — cadence defaults to 'persistent'; actual scheduling is configured in the Rules step
  const [basicInfo, setBasicInfo] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
    cadence_timeframe: 'persistent' as CadenceTimeframe
  })

  const [team, setTeam] = useState<TeamMember[]>([])
  const [filters, setFilters] = useState<FilterRule[]>([])
  const [logicExpression, setLogicExpression] = useState<LogicToken[]>([])
  const [stages, setStages] = useState<WizardStage[]>([]) // Start with no stages
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [customWorkflowMode, setCustomWorkflowMode] = useState(false)
  const [automationRules, setAutomationRules] = useState<AutomationRuleData[]>([])
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<Set<string>>(new Set())

  // User search & selection state
  const [userSearchTerm, setUserSearchTerm] = useState('')
  const [selectedRole, setSelectedRole] = useState<'admin' | 'stakeholder'>('admin')

  // Universe filter modal state
  const [showFilterModal, setShowFilterModal] = useState(false)
  const [editingFilter, setEditingFilter] = useState<FilterRule | null>(null)
  const [filterType, setFilterType] = useState<string | null>(null)
  const [filterOperator, setFilterOperator] = useState<FilterOperator>('includes')
  const [filterValues, setFilterValues] = useState<any>(null)
  const [filterSearchTerm, setFilterSearchTerm] = useState('')
  const [selectedTokens, setSelectedTokens] = useState<Set<number>>(new Set())

  // Automation rule inline builder state (replaces stacked modals)
  const [ruleBuilderMode, setRuleBuilderMode] = useState<'branch_creation' | 'asset_population' | 'branch_ending' | null>(null)
  const ruleBuilderDirtyRef = useRef(false)

  // Dirty-aware exit from rule builder — used by Cancel, Back, and ESC
  const handleExitRuleBuilder = useCallback(() => {
    if (ruleBuilderDirtyRef.current) {
      if (!window.confirm('Discard unsaved rule?')) return
    }
    ruleBuilderDirtyRef.current = false
    setRuleBuilderMode(null)
  }, [])

  // Track dirty state from embedded rule forms
  const handleRuleDirtyChange = useCallback((dirty: boolean) => {
    ruleBuilderDirtyRef.current = dirty
  }, [])

  // ESC key: when in rule builder → exit builder (with dirty confirm);
  // otherwise let the wizard handle its own close behavior
  useEffect(() => {
    if (!ruleBuilderMode) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        handleExitRuleBuilder()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [ruleBuilderMode, handleExitRuleBuilder])

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

  // Query for portfolios (used when scopeType === 'portfolio')
  const { data: allPortfolios = [] } = useQuery({
    queryKey: ['portfolios-for-wizard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: scopeType === 'portfolio',
  })

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

  // Name quality validation — exact matches and word-boundary patterns
  const GENERIC_EXACT = ['test', 'testing', 'new', 'process', 'new process', 'temp', 'temporary', 'asdf', 'untitled', 'tmp', 'abc', 'aaa', 'foo', 'bar', 'workflow']
  const GENERIC_PATTERN = /^(test(ing)?|temp(orary)?|new|asdf|untitled)\b|\b(test(ing)?|temp)\s*(process|workflow)?$/i
  const isGenericName = (name: string) => {
    const lower = name.trim().toLowerCase()
    return GENERIC_EXACT.includes(lower) || GENERIC_PATTERN.test(lower)
  }
  const hasSubstantialDescription = basicInfo.description.trim().length >= 10

  // Two-stage validation: warning (while typing) → error (after continue attempt)
  // Returns { level, message } or null
  const getNameValidation = (name: string): { level: 'warning' | 'error'; message: string } | null => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return null
    if (trimmed.length < 3) {
      return continueAttempted
        ? { level: 'error', message: 'Name must be at least 3 characters.' }
        : { level: 'warning', message: 'Name must be at least 3 characters.' }
    }
    if (isGenericName(trimmed) && !hasSubstantialDescription) {
      return continueAttempted
        ? { level: 'error', message: 'A more descriptive name (or short description) is required to continue.' }
        : { level: 'warning', message: 'Use a descriptive name users will recognize — or add a short description.' }
    }
    return null
  }

  // Soft note when generic name is rescued by description
  const getNameNote = (name: string): string | null => {
    const trimmed = name.trim()
    if (trimmed.length >= 3 && isGenericName(trimmed) && hasSubstantialDescription) {
      return 'Thanks — description helps clarify purpose.'
    }
    return null
  }

  // Whether name is blocked (controls isStepValid + Continue button)
  const isNameBlocked = (name: string): boolean => {
    const trimmed = name.trim()
    if (trimmed.length < 3) return true
    if (isGenericName(trimmed) && !hasSubstantialDescription) return true
    return false
  }

  // Validate current step — uses step ID for dynamic step ordering
  const isStepValid = (step: number): boolean => {
    const stepId = STEPS[step]?.id
    switch (stepId) {
      case 'basic':
        return !isNameBlocked(basicInfo.name)
      case 'team':
        // Creator is always Admin — step is valid even with empty team
        return true
      case 'universe':
        return true
      case 'portfolios':
        return true
      case 'stages':
        return stages.length > 0 && stages.every(s => s.stage_label.trim().length > 0)
      case 'automation':
        return true
      default:
        return true
    }
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
      suggested_priorities: [],
      checklist_items: [],
    }
    setStages([...stages, newStage])
    setExpandedStages(prev => new Set(prev).add(newStage.stage_key))
  }

  // Handle adding a stage at a specific position
  const handleAddStageAt = (position: number) => {
    const newStage: WizardStage = {
      stage_key: `stage_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      stage_label: '',
      stage_description: '',
      stage_color: '#3b82f6',
      stage_icon: '',
      sort_order: position + 1,
      standard_deadline_days: 7,
      suggested_priorities: [],
      checklist_items: [],
    }
    const newStages = [...stages]
    newStages.splice(position, 0, newStage)
    setStages(newStages.map((s, i) => ({ ...s, sort_order: i + 1 })))
    setExpandedStages(prev => new Set(prev).add(newStage.stage_key))
  }

  // Handle applying a template
  const handleApplyTemplate = (templateId: string) => {
    const TEMPLATES: Record<string, { label: string; description: string; items: string[] }[]> = {
      earnings: [
        { label: 'Prep', description: 'Gather data, review estimates, identify focus areas', items: ['Review consensus estimates', 'Prepare model inputs'] },
        { label: 'Analyze', description: 'Process results and update models', items: ['Update financial model', 'Compare vs expectations'] },
        { label: 'Decide', description: 'Form investment view and document thesis', items: ['Draft investment note', 'Set target/rating'] },
        { label: 'Complete', description: 'Finalize and communicate decision', items: ['Publish recommendation', 'Notify stakeholders'] },
      ],
      thesis_refresh: [
        { label: 'Review', description: 'Revisit existing thesis and assumptions', items: ['Read prior thesis', 'Identify changed assumptions'] },
        { label: 'Research', description: 'Conduct updated analysis', items: ['Update comparable analysis', 'Review recent developments'] },
        { label: 'Reassess', description: 'Determine if thesis still holds', items: ['Score thesis confidence', 'Document key risks'] },
        { label: 'Publish', description: 'Communicate updated view', items: ['Update investment note', 'Distribute to team'] },
      ],
      rebalance: [
        { label: 'Analyze', description: 'Review portfolio drift and opportunities', items: ['Measure tracking error', 'Identify largest deviations'] },
        { label: 'Propose', description: 'Draft rebalancing trades', items: ['Generate trade list', 'Check liquidity constraints'] },
        { label: 'Approve', description: 'Get sign-off from decision makers', items: ['PM review', 'Compliance check'] },
        { label: 'Execute', description: 'Submit and monitor trades', items: ['Submit orders', 'Confirm fills'] },
      ],
    }

    const template = TEMPLATES[templateId]
    if (!template) return

    const now = Date.now()
    const newStages = template.map((t, i) => ({
      stage_key: `stage_${now}_${i}_${Math.random().toString(36).substring(2, 8)}`,
      stage_label: t.label,
      stage_description: t.description,
      stage_color: '#3b82f6',
      stage_icon: '',
      sort_order: i + 1,
      standard_deadline_days: 7,
      suggested_priorities: [],
      checklist_items: t.items,
    }))
    setStages(newStages)
    setActiveTemplateId(templateId)
    setCustomWorkflowMode(false)
    // Expand the first stage
    setExpandedStages(new Set([newStages[0].stage_key]))
  }

  // Toggle stage expansion
  const toggleStageExpansion = (stageKey: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev)
      if (next.has(stageKey)) next.delete(stageKey)
      else next.add(stageKey)
      return next
    })
  }

  // Generic stage name detection
  const GENERIC_STAGE_NAMES = ['test', 'testing', 'stage 1', 'stage 2', 'stage 3', 'new stage', 'untitled', 'asdf', 'temp']
  const hasGenericStageName = stages.some(s => GENERIC_STAGE_NAMES.includes(s.stage_label.trim().toLowerCase()))

  // Template display metadata
  const TEMPLATE_OPTIONS = [
    { id: 'earnings', label: 'Earnings Review', stages: ['Prep', 'Analyze', 'Decide', 'Complete'], count: 4 },
    { id: 'thesis_refresh', label: 'Investment Thesis Refresh', stages: ['Review', 'Research', 'Reassess', 'Publish'], count: 4 },
    { id: 'rebalance', label: 'Portfolio Rebalance', stages: ['Analyze', 'Propose', 'Approve', 'Execute'], count: 4 },
  ]
  const activeTemplateMeta = TEMPLATE_OPTIONS.find(t => t.id === activeTemplateId)

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
      case 'priority':
        return [
          { value: 'critical', label: 'Critical' },
          { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' },
          { value: 'low', label: 'Low' }
        ]
      case 'country':
        return [
          { value: 'US', label: 'United States' },
          { value: 'CA', label: 'Canada' },
          { value: 'GB', label: 'United Kingdom' },
          { value: 'DE', label: 'Germany' },
          { value: 'FR', label: 'France' },
          { value: 'JP', label: 'Japan' },
          { value: 'CN', label: 'China' },
          { value: 'AU', label: 'Australia' },
          { value: 'CH', label: 'Switzerland' },
          { value: 'HK', label: 'Hong Kong' }
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
    // Initialize filterValues based on filter type
    if (type === 'financial_metric') {
      setFilterValues({ metric: '', min: null, max: null })
    } else if (definition?.valueType === 'multi_select') {
      setFilterValues([])
    } else {
      setFilterValues(null)
    }
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
    // Handle financial_metric filter
    if (rule.type === 'financial_metric' && typeof rule.values === 'object' && rule.values !== null) {
      const metricLabels: Record<string, string> = {
        market_cap: 'Market Cap',
        price: 'Stock Price',
        volume: 'Trading Volume',
        pe_ratio: 'P/E Ratio',
        dividend_yield: 'Dividend Yield'
      }
      const parts = [metricLabels[rule.values.metric] || rule.values.metric]
      if (rule.values.min !== null && rule.values.min !== undefined) {
        parts.push(`Min: ${rule.values.min}`)
      }
      if (rule.values.max !== null && rule.values.max !== undefined) {
        parts.push(`Max: ${rule.values.max}`)
      }
      return parts.join(', ')
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
        // Coverage flows through membership - get assets covered by users who are members of the portfolio
        if (Array.isArray(filter.values) && filter.values.length > 0) {
          // Find org_chart_nodes for these portfolios
          const { data: portfolioNodes } = await supabase
            .from('org_chart_nodes')
            .select('id, settings')
            .eq('node_type', 'portfolio')

          const portfolioNodeIds = (portfolioNodes || [])
            .filter(n => n.settings?.portfolio_id && filter.values.includes(n.settings.portfolio_id))
            .map(n => n.id)

          if (portfolioNodeIds.length > 0) {
            // Get members of these portfolio nodes
            const { data: members } = await supabase
              .from('org_chart_node_members')
              .select('user_id')
              .in('node_id', portfolioNodeIds)

            const memberUserIds = [...new Set((members || []).map(m => m.user_id))]

            if (memberUserIds.length > 0) {
              // Get coverage by these users
              const { data: portfolioCoverage } = await supabase
                .from('coverage')
                .select('asset_id')
                .in('user_id', memberUserIds)
                .eq('is_active', true)
              filterAssetIds = portfolioCoverage?.map(p => p.asset_id).filter(Boolean) || []
            }
          }
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
      setPreviewError('No eligibility rules defined — all assets would be included in the next run.')
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

  // Open inline rule builder for branch creation
  const openBranchRuleModal = () => {
    setRuleBuilderMode('branch_creation')
  }

  // Open inline rule builder for asset population
  const openAssetRuleModal = () => {
    setRuleBuilderMode('asset_population')
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
    ruleBuilderDirtyRef.current = false
    setRuleBuilderMode(null)
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
    ruleBuilderDirtyRef.current = false
    setRuleBuilderMode(null)
  }

  // Open inline rule builder for branch ending
  const openBranchEndingRuleModal = () => {
    setRuleBuilderMode('branch_ending')
  }

  // Save branch ending rule from AddBranchEndingRuleModal
  const handleSaveBranchEndingRule = (ruleData: any) => {
    const newRule: AutomationRuleData = {
      id: `rule_${Date.now()}`,
      name: ruleData.name,
      type: ruleData.type || 'time',
      conditionType: ruleData.conditionType,
      conditionValue: ruleData.conditionValue,
      actionType: ruleData.actionType,
      actionValue: ruleData.actionValue,
      isActive: ruleData.isActive,
      rule_category: 'branch_ending'
    }
    setAutomationRules([...automationRules, newRule])
    ruleBuilderDirtyRef.current = false
    setRuleBuilderMode(null)
  }

  // Create the workflow
  const handleSubmit = async () => {
    if (!user) return

    // Prevent multiple submissions using ref (synchronous check)
    if (isSubmittingRef.current) return
    isSubmittingRef.current = true

    setIsSubmitting(true)
    setSubmitError(null)
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
          created_by: user.id,
          scope_type: scopeType,
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
          suggested_priorities: s.suggested_priorities,
          checklist_items: s.checklist_items,
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
          permission: 'admin',
          invited_by: user.id
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

      // 5b. Save portfolio selections (for portfolio-scoped workflows)
      if (scopeType === 'portfolio' && selectedPortfolioIds.size > 0) {
        const portfolioData = Array.from(selectedPortfolioIds).map(pid => ({
          workflow_id: workflowId,
          portfolio_id: pid,
        }))
        const { error: portfolioError } = await supabase
          .from('workflow_portfolio_selections')
          .insert(portfolioData)
        if (portfolioError) throw portfolioError
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

      // Complete - modal will close, no need to reset isSubmitting
      onComplete(workflowId)
    } catch (error: any) {
      console.error('Error creating workflow:', error)
      setSubmitError(error?.message || 'Failed to create workflow. Please try again.')
      // Only reset on error so user can retry
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  // Render step content — uses step ID for dynamic step ordering
  const renderStepContent = () => {
    const stepId = STEPS[currentStep]?.id
    switch (stepId) {
      case 'basic':
        return renderBasicInfoStep()
      case 'team':
        return renderTeamStep()
      case 'universe':
        return renderUniverseStep()
      case 'portfolios':
        return renderPortfolioStep()
      case 'stages':
        return renderStagesStep()
      case 'automation':
        return renderAutomationStep()
      default:
        return null
    }
  }

  // Step 1: Basics
  const renderBasicInfoStep = () => {
    const nameValidation = getNameValidation(basicInfo.name)
    const nameNote = getNameNote(basicInfo.name)
    const scopeLabel = SCOPE_OPTIONS.find(o => o.value === scopeType)?.label || scopeType
    // Proper article: "an asset-scoped" vs "a standalone"
    const scopeSummary = scopeLabel.toLowerCase() === 'assets' ? 'asset' : scopeLabel.toLowerCase() === 'portfolios' ? 'portfolio' : scopeLabel.toLowerCase()
    const article = /^[aeiou]/i.test(scopeSummary) ? 'an' : 'a'

    // Input border: neutral by default, amber for warning, red only after continue attempt
    const inputBorderClass = nameValidation
      ? nameValidation.level === 'error' ? 'border-red-300 bg-red-50/20' : 'border-gray-300'
      : 'border-gray-300'

    return (
      <div className="space-y-5">
        {/* ─── Identity ─────────────────────────────────────── */}
        <section>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2.5">Identity</h3>

          {/* Process Name */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Process Name <span className="text-red-400">*</span>
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={basicInfo.name}
              onChange={(e) => {
                setBasicInfo({ ...basicInfo, name: e.target.value })
                // Clear the hard-error state as user corrects
                if (continueAttempted) setContinueAttempted(false)
              }}
              className={`w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base transition-colors ${inputBorderClass}`}
              placeholder="e.g., Quarterly Earnings Review"
              autoFocus
            />
            {/* Warning state (pre-submit) */}
            {nameValidation?.level === 'warning' && (
              <p className="mt-1.5 text-xs text-gray-500 flex items-center space-x-1.5">
                <AlertCircle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                <span>{nameValidation.message}</span>
              </p>
            )}
            {/* Error state (after continue attempt) */}
            {nameValidation?.level === 'error' && (
              <p className="mt-1.5 text-xs text-red-600 flex items-center space-x-1.5">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                <span>{nameValidation.message}</span>
              </p>
            )}
            {/* Soft note when generic name is rescued by description */}
            {!nameValidation && nameNote && (
              <p className="mt-1.5 text-xs text-green-600 flex items-center space-x-1.5">
                <Check className="w-3 h-3 flex-shrink-0" />
                <span>{nameNote}</span>
              </p>
            )}
          </div>

          {/* Collapsible Description */}
          <div>
            <button
              type="button"
              onClick={() => setDescExpanded(!descExpanded)}
              className="flex items-center space-x-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${descExpanded ? '' : '-rotate-90'}`} />
              <span>{descExpanded ? 'Description' : 'Add a description'}</span>
              {!descExpanded && !basicInfo.description && (
                <span className="text-xs text-gray-400 italic ml-1">recommended</span>
              )}
            </button>
            {descExpanded && (
              <div className="mt-2">
                <textarea
                  value={basicInfo.description}
                  onChange={(e) => setBasicInfo({ ...basicInfo, description: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  rows={2}
                  placeholder="What is the purpose of this process? Who should use it?"
                />
                {!basicInfo.description && (
                  <p className="mt-1 text-xs text-gray-400">
                    One sentence is enough. This helps others understand why this exists.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ─── Applies To ───────────────────────────────────── */}
        <section>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Applies To</h3>
          <p className="text-xs text-gray-400 mb-2.5">Determines where runs appear and how work is tracked.</p>
          <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Process scope type">
            {SCOPE_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const isSelected = scopeType === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setScopeType(opt.value)}
                  className={`flex flex-col items-start p-3 rounded-lg border-2 transition-all text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/50 shadow-sm ring-1 ring-blue-200'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-center space-x-2 mb-0.5">
                    <Icon className={`w-4 h-4 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                    <span className={`text-sm font-medium ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>
                      {opt.label}
                    </span>
                  </div>
                  <span className={`text-xs leading-snug ${isSelected ? 'text-blue-600/70' : 'text-gray-500'}`}>{opt.description}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ─── Appearance ───────────────────────────────────── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Appearance</h3>
          <div className="flex items-center space-x-3">
            <Palette className="w-4 h-4 text-gray-300" />
            <input
              type="color"
              value={basicInfo.color}
              onChange={(e) => setBasicInfo({ ...basicInfo, color: e.target.value })}
              className="w-8 h-8 rounded border border-gray-200 cursor-pointer"
            />
            <input
              type="text"
              value={basicInfo.color}
              onChange={(e) => setBasicInfo({ ...basicInfo, color: e.target.value })}
              className="w-24 px-2.5 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs font-mono text-gray-500"
            />
          </div>
        </section>

        {/* ─── Summary + scheduling framing ──────────────────── */}
        {basicInfo.name.trim().length >= 3 && !isNameBlocked(basicInfo.name) && (
          <div className="pt-2 border-t border-gray-100 space-y-1">
            <p className="text-sm text-gray-500">
              This will create {article}{' '}
              <span className="font-medium text-gray-700">{scopeSummary}-scoped</span> process named{' '}
              &ldquo;<span className="font-medium text-gray-900">{basicInfo.name.trim()}</span>.&rdquo;
            </p>
            <p className="text-xs text-gray-400">Scheduling and triggers are configured in the Rules step.</p>
          </div>
        )}
      </div>
    )
  }

  // Step 2: Process Governance
  const renderTeamStep = () => {
    // Users available to add (not already on the team, not self)
    const availableUsers = allUsers?.filter(u =>
      !team.some(t => t.userId === u.id) &&
      u.id !== user?.id &&
      (userSearchTerm.trim() === '' ||
        u.name.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearchTerm.toLowerCase()))
    ) || []

    const handleAddUser = (userId: string) => {
      const u = allUsers?.find(au => au.id === userId)
      if (!u) return
      const newMember: TeamMember = {
        id: `temp_${Date.now()}_${u.id}`,
        userId: u.id,
        email: u.email,
        name: u.name,
        role: selectedRole,
      }
      setTeam(prev => [...prev, newMember])
    }

    // Counts for governance summary
    const adminCount = team.filter(t => t.role === 'admin').length + 1 // +1 for creator
    const stakeholderCount = team.filter(t => t.role === 'stakeholder').length

    return (
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h3 className="text-lg font-medium text-gray-900">Process Governance</h3>
          <p className="text-sm text-gray-500 mt-0.5">Define who can manage this process and who can follow its progress.</p>
        </div>

        {/* ─── Owner ────────────────────────────────────────── */}
        <section>
          <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Owner</h4>
          <div className="flex items-center justify-between px-3 py-2 bg-blue-50/30 rounded-lg border border-blue-100/80">
            <div className="flex items-center space-x-2.5 min-w-0">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <span className="font-semibold text-xs text-blue-700">
                  {user?.email?.charAt(0).toUpperCase() || 'Y'}
                </span>
              </div>
              <span className="text-sm font-medium text-gray-900 truncate">{user?.email || 'You'}</span>
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
              <span
                className="inline-flex items-center space-x-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-600 text-white uppercase tracking-wide cursor-default"
                title="The creator must remain an Admin."
              >
                <Lock className="w-2.5 h-2.5" />
                <span>Admin</span>
              </span>
              <span className="text-[11px] text-gray-400">Creator</span>
            </div>
          </div>
        </section>

        {/* ─── Two-Panel Team Selector ─────────────────────── */}
        <section className="space-y-3">
          <div>
            <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Team Members</h4>
            <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">Add people who can manage this process or follow its progress.</p>
          </div>

          {/* ── Assigned Panel (fixed height) ───────────────── */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/40">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
              <span className="text-[11px] font-medium text-gray-500">
                Assigned{team.length > 0 ? ` (${team.length})` : ''}
              </span>
              {team.length > 0 && (
                <span className="text-[10px] text-gray-400">
                  {adminCount} admin{adminCount !== 1 ? 's' : ''} &middot; {stakeholderCount} stakeholder{stakeholderCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="h-[132px] overflow-y-auto">
              {team.length > 0 ? (
                <div className="p-1.5 space-y-px">
                  {team.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-md group hover:bg-white transition-colors"
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <div className={`w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0 ${
                          member.role === 'admin' ? 'bg-blue-100' : 'bg-emerald-50'
                        }`}>
                          <span className={`font-semibold text-[10px] ${
                            member.role === 'admin' ? 'text-blue-700' : 'text-emerald-700'
                          }`}>
                            {member.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-gray-800 truncate">{member.name}</span>
                      </div>
                      <div className="flex items-center space-x-1.5 flex-shrink-0 ml-2">
                        <button
                          type="button"
                          onClick={() => handleToggleRole(member.id)}
                          aria-label={`Change role for ${member.name}, currently ${member.role}`}
                          className="cursor-pointer"
                        >
                          <Badge
                            variant={member.role === 'admin' ? 'default' : 'success'}
                            className="cursor-pointer hover:opacity-80 text-[10px] px-1.5 py-0"
                          >
                            {member.role === 'admin' ? 'Admin' : 'Stakeholder'}
                          </Badge>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveTeamMember(member.id)}
                          aria-label={`Remove ${member.name}`}
                          className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-[11px] text-gray-400">No team members added yet.</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Available Users Panel (fixed height) ────────── */}
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            {/* Search bar — always visible at top */}
            <div className="flex items-center border-b border-gray-200 bg-white">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  value={userSearchTerm}
                  onChange={(e) => setUserSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
                  placeholder="Search by name or email..."
                />
              </div>
              <div className="border-l border-gray-200" />
              <div className="flex items-center space-x-1.5 px-2.5 flex-shrink-0">
                <span className="text-[11px] text-gray-400 whitespace-nowrap">Add as:</span>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as 'admin' | 'stakeholder')}
                  aria-label="Default role for new members"
                  className="px-1.5 py-1 border border-gray-200 rounded text-[11px] focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="admin">Admin</option>
                  <option value="stakeholder">Stakeholder</option>
                </select>
              </div>
            </div>

            {/* Scrollable user list — fixed height */}
            <div className="h-[168px] overflow-y-auto">
              {availableUsers.length > 0 ? (
                availableUsers.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => handleAddUser(u.id)}
                    className="w-full flex items-center px-3 py-1.5 text-left border-b border-gray-50 last:border-b-0 hover:bg-blue-50/30 transition-colors group/row"
                  >
                    <div className="w-[22px] h-[22px] rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mr-2.5">
                      <span className="font-semibold text-[10px] text-gray-500">
                        {u.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 flex items-center">
                      <span className="font-medium text-sm text-gray-900 truncate">{u.name}</span>
                      <span className="text-[11px] text-gray-400 ml-2 truncate">{u.email}</span>
                    </div>
                    <Plus className="w-3.5 h-3.5 text-gray-300 group-hover/row:text-blue-500 flex-shrink-0 ml-2 transition-colors" />
                  </button>
                ))
              ) : (
                <div className="h-full flex items-center justify-center">
                  <span className="text-sm text-gray-400">
                    {userSearchTerm.trim() ? 'No matching users' : 'All users have been added'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ─── Role Permissions ──────────────────────────────── */}
        <div className="rounded-lg border border-gray-100/80 bg-gray-50/20 px-4 py-2.5">
          <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Role Permissions</h4>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1">Admin</p>
              <ul className="space-y-0.5 text-[11px] text-gray-400 leading-relaxed">
                <li>Edit process structure and rules</li>
                <li>Manage access and team</li>
                <li>Start and end runs</li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1">Stakeholder</p>
              <ul className="space-y-0.5 text-[11px] text-gray-400 leading-relaxed">
                <li>View process progress</li>
                <li>Receive notifications</li>
              </ul>
            </div>
          </div>
          {team.length > 0 && (
            <p className="text-[10px] text-gray-300 mt-2">Tip: Click role badges to reassign after adding.</p>
          )}
        </div>

        {/* ─── Governance summary ────────────────────────────── */}
        <div className="pt-1.5 border-t border-gray-100">
          <p className="text-[11px] text-gray-400">
            Admins {adminCount} (including you) &middot; Stakeholders {stakeholderCount}
          </p>
        </div>
      </div>
    )
  }

  // Step 3: Universe
  // Short descriptor lines for each rule category
  const RULE_DESCRIPTORS: Record<string, string> = {
    analyst: 'Assets covered by selected analysts',
    list: 'Include assets from a saved list',
    theme: 'Assets tagged to a theme',
    portfolio: 'Assets held in selected portfolios',
    sector: 'Filter by sector classification',
    priority: 'Include based on priority tagging',
    financial_metric: 'Filter by metric thresholds',
    country: 'Filter by country exposure/domicile',
  }

  const renderUniverseStep = () => (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-medium text-gray-900">Eligibility Rules</h3>
        <p className="text-sm text-gray-500 mt-0.5">Define which assets will be included in every run of this process.</p>
      </div>

      {/* ─── Rule Canvas ───────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-gray-50/40">
        {/* Canvas header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200/80">
          <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Rules</h4>
          {filters.length > 0 && (
            <div className="flex items-center space-x-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fetchPreviewAssets}
                className="text-[11px] h-6"
              >
                <Eye className="w-3 h-3 mr-1" />
                Preview next run
              </Button>
              <button
                type="button"
                onClick={() => {
                  setFilters([])
                  setLogicExpression([])
                }}
                className="text-[11px] text-gray-400 hover:text-red-500 transition-colors"
              >
                Clear rules
              </button>
            </div>
          )}
        </div>

        {/* Canvas body */}
        <div className="px-4 py-3">
          {filters.length === 0 ? (
            /* ─── Empty state ──────────────────────────────── */
            <div className="flex items-start space-x-3 py-2">
              <Info className="w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-500">No eligibility rules defined</p>
                <p className="text-[11px] text-gray-400 mt-0.5">All assets will be included in this process.</p>
              </div>
            </div>
          ) : (
            /* ─── Rule list ────────────────────────────────── */
            <div className="space-y-1.5">
              {filters.map((filter) => {
                const definition = getFilterDefinition(filter.type)
                if (!definition) return null
                const Icon = definition.icon

                return (
                  <div
                    key={filter.id}
                    className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-gray-150 hover:border-gray-300 transition-colors group"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <Icon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-700 flex-shrink-0">{definition.name}</span>
                      <span className={`text-xs flex-shrink-0 ${filter.operator === 'excludes' ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                        {OPERATOR_LABELS[filter.operator]}
                      </span>
                      <span className="text-sm text-gray-900 truncate">{formatFilterValue(filter)}</span>
                    </div>
                    <div className="flex items-center space-x-1 flex-shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => openEditFilterModal(filter)}
                        className="text-gray-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50 transition-colors"
                        aria-label={`Edit ${definition.name} rule`}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteFilter(filter.id)}
                        className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                        aria-label={`Remove ${definition.name} rule`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Logic Builder — only when 2+ rules */}
        {filters.length >= 2 && (
          <div className="mx-4 mb-3 bg-white border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Filter Logic</h4>
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
            <div className="flex flex-wrap items-center gap-1.5 p-2.5 bg-gray-50 border border-gray-100 rounded min-h-[40px]">
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

            <p className="text-[10px] text-gray-400 mt-1.5">
              Click filters to select, then "Group Selected" to add parentheses. Click <span className="font-bold text-purple-600">( )</span> to remove group. Click <span className="text-green-600 font-medium">AND</span>/<span className="text-orange-600 font-medium">OR</span> to toggle.
            </p>
          </div>
        )}
      </div>

      {/* ─── Eligibility summary + timing note ──────────────── */}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-gray-400">
            {filters.length === 0
              ? 'Eligibility: All assets'
              : `Eligibility: ${filters.length} rule${filters.length !== 1 ? 's' : ''} applied`
            }
          </p>
        </div>
        <p className="text-[10px] text-gray-300">Eligibility is evaluated at run start. Assets are snapshotted into the run; later changes are tracked.</p>
      </div>

      {/* ─── Add rule blocks ───────────────────────────────── */}
      <section>
        <p className="text-[11px] font-medium text-gray-500 mb-2">Add another rule:</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {['analyst', 'list', 'theme', 'portfolio', 'sector', 'priority', 'financial_metric', 'country'].map((ft) => {
            const definition = getFilterDefinition(ft)
            if (!definition) return null
            const Icon = definition.icon

            return (
              <button
                key={ft}
                type="button"
                onClick={() => openNewFilterModal(ft)}
                className="flex items-start space-x-2.5 p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/50 transition-colors text-left group"
              >
                <Icon className="w-4 h-4 text-gray-400 group-hover:text-blue-500 flex-shrink-0 mt-0.5 transition-colors" />
                <div className="min-w-0">
                  <span className="font-medium text-gray-700 text-sm block leading-tight">{definition.name}</span>
                  <span className="text-[10px] text-gray-400 leading-tight block mt-0.5">{RULE_DESCRIPTORS[ft]}</span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

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
                <div className="flex flex-wrap gap-2">
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

              {/* Value Selection - Different UI based on filter type */}
              {filterType === 'financial_metric' ? (
                <div className="space-y-4">
                  {/* Metric Selector */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Select Metric</label>
                    <select
                      value={filterValues?.metric || ''}
                      onChange={(e) => setFilterValues({ ...filterValues, metric: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Choose a metric...</option>
                      <option value="market_cap">Market Cap</option>
                      <option value="price">Stock Price</option>
                      <option value="volume">Trading Volume</option>
                      <option value="pe_ratio">P/E Ratio</option>
                      <option value="dividend_yield">Dividend Yield</option>
                    </select>
                  </div>

                  {/* Value Inputs */}
                  {filterValues?.metric && (
                    <>
                      {filterOperator === 'greater_than' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Value</label>
                          <input
                            type="number"
                            placeholder="Enter minimum"
                            value={filterValues?.min || ''}
                            onChange={(e) => setFilterValues({ ...filterValues, min: parseFloat(e.target.value) || null })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                        </div>
                      )}
                      {filterOperator === 'less_than' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Maximum Value</label>
                          <input
                            type="number"
                            placeholder="Enter maximum"
                            value={filterValues?.max || ''}
                            onChange={(e) => setFilterValues({ ...filterValues, max: parseFloat(e.target.value) || null })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                        </div>
                      )}
                      {filterOperator === 'between' && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Min</label>
                            <input
                              type="number"
                              placeholder="Min"
                              value={filterValues?.min || ''}
                              onChange={(e) => setFilterValues({ ...filterValues, min: parseFloat(e.target.value) || null })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Max</label>
                            <input
                              type="number"
                              placeholder="Max"
                              value={filterValues?.max || ''}
                              onChange={(e) => setFilterValues({ ...filterValues, max: parseFloat(e.target.value) || null })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            />
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
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
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <Button variant="outline" onClick={() => setShowFilterModal(false)}>Cancel</Button>
              <Button
                onClick={saveFilter}
                disabled={(() => {
                  if (filterType === 'financial_metric') {
                    return !filterValues?.metric || (!filterValues?.min && !filterValues?.max)
                  }
                  return !Array.isArray(filterValues) || filterValues.length === 0
                })()}
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
                <h3 className="text-lg font-semibold text-gray-900">Next run snapshot (preview)</h3>
                <p className="text-sm text-gray-500">
                  {isLoadingPreview ? 'Loading...' : previewAssets.length > 0 ? `${previewAssets.length}${previewAssets.length === 100 ? '+' : ''} assets would be included if a run started now` : 'No matching assets'}
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

            <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between">
              <p className="text-[10px] text-gray-300">Starting scope is locked per run; any additions or removals are logged.</p>
              <Button variant="outline" onClick={() => setShowPreviewModal(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // Step: Portfolio selector (for portfolio-scoped workflows)
  const [portfolioSearchTerm, setPortfolioSearchTerm] = useState('')

  const filteredPortfolios = allPortfolios.filter(p =>
    p.name.toLowerCase().includes(portfolioSearchTerm.toLowerCase())
  )

  const renderPortfolioStep = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Select Portfolios</h3>
        <p className="text-sm text-gray-500 mt-1">
          Choose which portfolios this process will track. Each portfolio will progress through stages independently.
        </p>
      </div>

      {allPortfolios.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Briefcase className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">No portfolios available.</p>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={portfolioSearchTerm}
              onChange={(e) => setPortfolioSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              placeholder="Search portfolios..."
            />
          </div>
          <div className="space-y-1 max-h-[400px] overflow-y-auto border border-gray-200 rounded-lg">
            {filteredPortfolios.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">
                No portfolios match "{portfolioSearchTerm}"
              </div>
            ) : (
              filteredPortfolios.map((portfolio) => {
                const isSelected = selectedPortfolioIds.has(portfolio.id)
                return (
                  <label
                    key={portfolio.id}
                    className={`flex items-center px-4 py-3 cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setSelectedPortfolioIds(prev => {
                          const next = new Set(prev)
                          if (next.has(portfolio.id)) {
                            next.delete(portfolio.id)
                          } else {
                            next.add(portfolio.id)
                          }
                          return next
                        })
                      }}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className={`ml-3 text-sm ${isSelected ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
                      {portfolio.name}
                    </span>
                  </label>
                )
              })
            )}
          </div>
        </>
      )}

      {selectedPortfolioIds.size > 0 && (
        <p className="text-xs text-gray-500">
          {selectedPortfolioIds.size} portfolio{selectedPortfolioIds.size !== 1 ? 's' : ''} selected
        </p>
      )}
    </div>
  )

  // Step 4: Stages
  const renderStagesStep = () => {
    // Determine view mode: builder (stages exist), custom-empty (chose custom but no stages yet), or selection (initial)
    const showBuilder = stages.length > 0
    const showCustomEmpty = !showBuilder && customWorkflowMode

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Workflow Structure</h3>
            <p className="text-sm text-gray-500 mt-0.5">Define how work progresses in each run.</p>
          </div>
          {showBuilder && (
            <Button size="sm" variant="outline" onClick={handleAddStage} className="text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add Stage
            </Button>
          )}
        </div>

        {showBuilder ? (
          /* ─── Stage builder ──────────────────────────────── */
          <div>
            {/* Template confirmation banner */}
            {activeTemplateMeta && (
              <div className="flex items-center justify-between px-3 py-2 mb-3 rounded-md bg-blue-50/40 border border-blue-100/60">
                <p className="text-[11px] text-gray-600">
                  Using <span className="font-semibold">{activeTemplateMeta.label}</span> template ({activeTemplateMeta.count} stages)
                </p>
                <button
                  type="button"
                  onClick={() => { setStages([]); setExpandedStages(new Set()); setActiveTemplateId(null) }}
                  className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                >
                  Change template
                </button>
              </div>
            )}

            {/* Stage list with flow connectors */}
            {stages.map((stage, index) => {
              const isExpanded = expandedStages.has(stage.stage_key)
              const isLast = index === stages.length - 1
              const stageNameLower = stage.stage_label.trim().toLowerCase()
              const isGenericName = GENERIC_STAGE_NAMES.includes(stageNameLower)

              return (
                <div key={stage.stage_key}>
                  {/* Insert-between button */}
                  {index > 0 && (
                    <div className="flex justify-center py-1.5">
                      <div className="flex flex-col items-center">
                        <div className="w-px h-2.5 bg-gray-200" />
                        <button
                          type="button"
                          onClick={() => handleAddStageAt(index)}
                          className="w-5 h-5 rounded-full border border-gray-200 bg-white flex items-center justify-center text-gray-300 hover:text-blue-500 hover:border-blue-300 transition-colors"
                          title="Insert stage here"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <div className="w-px h-2.5 bg-gray-200" />
                      </div>
                    </div>
                  )}

                  {/* Stage card */}
                  <div className="bg-white border border-gray-150 rounded-lg hover:border-gray-250 transition-colors">
                    {/* ── Header row (always visible) ──────────── */}
                    <div
                      className="flex items-center px-3.5 py-2.5 cursor-pointer select-none"
                      onClick={() => toggleStageExpansion(stage.stage_key)}
                    >
                      <GripVertical className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 mr-2 cursor-grab" />
                      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-50 text-blue-600 font-semibold text-xs flex-shrink-0 mr-3">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0 flex items-center space-x-2">
                        {isExpanded ? (
                          <input
                            type="text"
                            value={stage.stage_label}
                            onChange={(e) => handleUpdateStage(stage.stage_key, { stage_label: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            className="font-semibold text-[15px] text-gray-900 bg-transparent border-0 border-b border-transparent focus:border-blue-400 focus:ring-0 px-0 py-0 w-full max-w-xs placeholder:text-gray-300"
                            placeholder="Stage name..."
                          />
                        ) : (
                          <span className="font-semibold text-[15px] text-gray-900 truncate">
                            {stage.stage_label || <span className="text-gray-300 font-normal italic text-sm">Untitled stage</span>}
                          </span>
                        )}
                        {isLast && stages.length > 1 && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">Final</span>
                        )}
                        {stage.checklist_items.length > 0 && !isExpanded && (
                          <span className="text-[10px] text-gray-400 flex-shrink-0">{stage.checklist_items.length} criteria</span>
                        )}
                      </div>
                      <div className="flex items-center space-x-1 flex-shrink-0 ml-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRemoveStage(stage.stage_key) }}
                          className="text-gray-300 hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50"
                          aria-label={`Remove stage ${index + 1}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                      </div>
                    </div>

                    {/* ── Expanded body ────────────────────────── */}
                    {isExpanded && (
                      <div className="px-3.5 pb-3.5 pt-0 ml-[52px] space-y-3 border-t border-gray-100">
                        {/* Description */}
                        <div className="pt-3">
                          <label className="block text-[11px] font-medium text-gray-400 mb-1">Description</label>
                          <input
                            type="text"
                            value={stage.stage_description}
                            onChange={(e) => handleUpdateStage(stage.stage_key, { stage_description: e.target.value })}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-400 text-sm text-gray-700 placeholder:text-gray-300"
                            placeholder="What happens in this stage?"
                          />
                        </div>

                        {/* Completion criteria */}
                        <div>
                          <label className="block text-[11px] font-medium text-gray-400 mb-0.5">Completion Criteria</label>
                          <p className="text-[10px] text-gray-300 mb-1.5">Requirements to advance</p>
                          {stage.checklist_items.length > 0 && (
                            <div className="space-y-1 mb-1.5">
                              {stage.checklist_items.map((item, itemIdx) => (
                                <div key={itemIdx} className="flex items-center space-x-2 group">
                                  <div className="w-3.5 h-3.5 rounded border border-gray-200 flex-shrink-0" />
                                  <input
                                    type="text"
                                    value={item}
                                    onChange={(e) => {
                                      const updated = [...stage.checklist_items]
                                      updated[itemIdx] = e.target.value
                                      handleUpdateStage(stage.stage_key, { checklist_items: updated })
                                    }}
                                    className="flex-1 px-2 py-1 border border-gray-150 rounded text-sm text-gray-700 focus:ring-1 focus:ring-blue-500 focus:border-blue-400 placeholder:text-gray-300"
                                    placeholder="Describe requirement..."
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = stage.checklist_items.filter((_, i) => i !== itemIdx)
                                      handleUpdateStage(stage.stage_key, { checklist_items: updated })
                                    }}
                                    className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-0.5"
                                    aria-label="Remove requirement"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              handleUpdateStage(stage.stage_key, {
                                checklist_items: [...stage.checklist_items, ''],
                              })
                            }}
                            className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                          >
                            + Add requirement
                          </button>
                        </div>

                        {/* Generic name warning */}
                        {isGenericName && stage.stage_label.trim().length > 0 && (
                          <p className="text-[10px] text-amber-500 flex items-center space-x-1">
                            <AlertCircle className="w-3 h-3 flex-shrink-0" />
                            <span>Consider a descriptive name (e.g., &ldquo;Research&rdquo;, &ldquo;Review&rdquo;, &ldquo;Approval&rdquo;).</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Bottom add stage — centered, slightly prominent */}
            <div className="flex justify-center pt-3">
              <button
                type="button"
                onClick={handleAddStage}
                className="flex items-center space-x-1.5 text-xs text-gray-400 hover:text-blue-600 transition-colors py-2 px-4 rounded-lg border border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50/30"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add stage</span>
              </button>
            </div>

            {/* Generic stage name warning (global) */}
            {hasGenericStageName && (
              <p className="text-[10px] text-amber-500 mt-2 flex items-center space-x-1">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                <span>Consider using descriptive stage names (e.g., &ldquo;Research&rdquo;, &ldquo;Review&rdquo;, &ldquo;Approval&rdquo;).</span>
              </p>
            )}
          </div>
        ) : showCustomEmpty ? (
          /* ─── Custom workflow empty state ─────────────────── */
          <div className="rounded-lg border border-gray-100 bg-gray-50/20 px-5 py-8 text-center">
            <Layers className="w-7 h-7 text-gray-300 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-gray-800 mb-1">Start Designing Your Workflow</h4>
            <p className="text-[11px] text-gray-400 mb-4">Add stages to define how work progresses.</p>
            <Button size="sm" onClick={handleAddStage}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add first stage
            </Button>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setCustomWorkflowMode(false)}
                className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
              >
                Back to templates
              </button>
            </div>
          </div>
        ) : (
          /* ─── Template / custom selection ─────────────────── */
          <div className="rounded-lg border border-gray-100 bg-gray-50/20 px-5 py-4">
            {/* Templates section — recommended path */}
            <div className="mb-4">
              <div className="flex items-center space-x-2 mb-2.5">
                <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Templates</h4>
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 uppercase tracking-wide">Recommended</span>
              </div>
              <div className="space-y-2">
                {TEMPLATE_OPTIONS.map(t => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between px-3.5 py-3 rounded-lg border border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm transition-all group"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-semibold text-gray-800 group-hover:text-blue-700 transition-colors">{t.label}</span>
                        <span className="text-[10px] text-gray-400">{t.count} stages</span>
                      </div>
                      <div className="flex items-center space-x-1 mt-1">
                        {t.stages.map((s, i) => (
                          <React.Fragment key={s}>
                            <span className="text-[10px] text-gray-400">{s}</span>
                            {i < t.stages.length - 1 && <span className="text-[10px] text-gray-300">&rarr;</span>}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApplyTemplate(t.id)}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-md hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-all flex-shrink-0 ml-3"
                    >
                      Use template
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-300 mt-2">You can modify stages after selecting a template.</p>
            </div>

            {/* Divider */}
            <div className="flex items-center space-x-3 my-3">
              <div className="flex-1 h-px bg-gray-200/60" />
              <span className="text-[10px] text-gray-300 uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-gray-200/60" />
            </div>

            {/* Custom workflow option */}
            <button
              type="button"
              onClick={() => setCustomWorkflowMode(true)}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 transition-colors group"
            >
              <Plus className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors" />
              <div className="text-left">
                <span className="text-sm font-medium text-gray-700 group-hover:text-blue-700 transition-colors">Create custom workflow</span>
                <span className="text-[10px] text-gray-400 block">Design stages manually.</span>
              </div>
            </button>

            {/* Required guardrail */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="flex items-start space-x-2">
                <Info className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-gray-500">At least one stage is required</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Select a template or create a custom workflow to continue.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Step 5: Automation
  const renderAutomationStep = () => {
    const branchRules = automationRules.filter(r => r.rule_category === 'branch_creation')
    const assetRules = automationRules.filter(r => r.rule_category === 'asset_population')
    const endingRules = automationRules.filter(r => r.rule_category === 'branch_ending')

    // Helper to get rule description
    const getRuleDescription = (rule: AutomationRuleData): string => {
      const formatTime = (time: string): string => {
        if (!time) return ''
        const [hours, minutes] = time.split(':')
        const hour = parseInt(hours, 10)
        const ampm = hour >= 12 ? 'PM' : 'AM'
        const hour12 = hour % 12 || 12
        return `${hour12}:${minutes} ${ampm}`
      }

      // ── Asset population rules ─────────────────────────
      if (rule.rule_category === 'asset_population') {
        const triggerMap: Record<string, string> = {
          on_branch_creation: 'when run starts',
          days_before_earnings: `${rule.conditionValue?.days_offset || 0} days before earnings`,
          days_after_earnings: `${rule.conditionValue?.days_offset || 0} days after earnings`,
          manual_trigger: 'on manual trigger',
        }
        const trigger = triggerMap[rule.conditionType] || rule.conditionType
        const source = rule.actionType === 'add_universe_assets' ? 'universe assets' : 'specific assets'
        const stageName = rule.actionValue?.starting_stage
          ? stages.find(s => s.stage_key === rule.actionValue?.starting_stage)?.stage_label || rule.actionValue.starting_stage
          : 'first stage'
        return `Adds ${source} ${trigger}, entering at ${stageName}.`
      }

      // ── Branch ending rules ────────────────────────────
      if (rule.rule_category === 'branch_ending') {
        if (rule.conditionType === 'time_after_creation') {
          const cv = rule.conditionValue || {}
          const amount = cv.amount || 30
          const unit = cv.unit || 'days'
          let timeStr = `${amount} ${unit}`
          if (cv.secondaryAmount && cv.secondaryUnit) {
            timeStr += ` and ${cv.secondaryAmount} ${cv.secondaryUnit}`
          }
          if (cv.atSpecificTime && cv.triggerTime) {
            timeStr += ` at ${formatTime(cv.triggerTime)}`
          }
          return `Closes the run after ${timeStr}.`
        }
        if (rule.conditionType === 'days_after_creation') {
          return `Closes the run after ${rule.conditionValue?.days || 30} days.`
        }
        if (rule.conditionType === 'all_assets_completed') {
          return 'Closes the run when all assets complete.'
        }
        if (rule.conditionType === 'specific_date') {
          const cv = rule.conditionValue || {}
          let desc = cv.date
            ? `Closes the run on ${new Date(cv.date).toLocaleDateString()}`
            : 'Closes the run on a specific date'
          if (cv.triggerTime) {
            desc += ` at ${formatTime(cv.triggerTime)}`
          }
          return desc + '.'
        }
        if (rule.conditionType === 'manual_trigger') {
          return 'Closes the run when manually triggered.'
        }
        return rule.conditionType.replace(/_/g, ' ')
      }

      // ── Run creation rules (branch_creation) ──────────
      if (rule.type === 'perpetual') {
        return 'Always available — runs can be started at any time.'
      }

      if (rule.type === 'time') {
        const cv = rule.conditionValue
        if (cv?.pattern_type === 'daily') {
          return cv.daily_type === 'every_weekday'
            ? 'Creates a new run every weekday.'
            : cv.interval === 1
              ? 'Creates a new run every day.'
              : `Creates a new run every ${cv.interval} days.`
        }
        if (cv?.pattern_type === 'weekly') {
          const days = cv.days_of_week?.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')
          return cv.interval === 1
            ? `Creates a new run weekly on ${days || 'Mon'}.`
            : `Creates a new run every ${cv.interval} weeks on ${days || 'Mon'}.`
        }
        if (cv?.pattern_type === 'monthly') {
          if (cv.monthly_type === 'day_of_month') {
            return cv.interval === 1
              ? `Creates a new run on Day ${cv.day_number || 1} of each month.`
              : `Creates a new run on Day ${cv.day_number || 1} every ${cv.interval} months.`
          }
          return cv.interval === 1
            ? `Creates a new run on the ${cv.position || 'First'} ${cv.day_name || 'Monday'} of each month.`
            : `Creates a new run on the ${cv.position || 'First'} ${cv.day_name || 'Monday'} every ${cv.interval} months.`
        }
        if (cv?.pattern_type === 'quarterly') {
          return cv.interval === 1
            ? 'Creates a new run every quarter.'
            : `Creates a new run every ${cv.interval} quarters.`
        }
        if (cv?.pattern_type === 'yearly') {
          return `Creates a new run yearly on ${cv.month || 'January'} ${cv.day_number || 1}.`
        }
        return 'Creates a new run on a time-based schedule.'
      }

      if (rule.type === 'event') {
        if (rule.conditionType === 'earnings_date') {
          const timing = rule.conditionValue?.timing || 'before'
          const days = rule.conditionValue?.days_offset || 0
          return `Creates a new run ${days} days ${timing} earnings.`
        }
        if (rule.conditionType === 'price_change') {
          return `Creates a new run when price ${rule.conditionValue?.direction || 'changes'} by ${rule.conditionValue?.percentage || 0}%.`
        }
        if (rule.conditionType === 'volume_spike') {
          return `Creates a new run when volume exceeds ${rule.conditionValue?.multiplier || 2}× average.`
        }
        if (rule.conditionType === 'dividend_date') {
          return `Creates a new run ${rule.conditionValue?.days_offset || 0} days ${rule.conditionValue?.timing || 'before'} dividend.`
        }
        return `Creates a new run on ${rule.conditionType.replace(/_/g, ' ')}.`
      }

      if (rule.type === 'activity') {
        return `Creates a new run on ${rule.conditionType.replace(/_/g, ' ')}.`
      }

      return rule.conditionType?.replace(/_/g, ' ') || 'Custom rule'
    }

    const totalRules = branchRules.length + assetRules.length + endingRules.length

    // ─── Inline Rule Builder ────────────────────────────────
    if (ruleBuilderMode) {
      const categoryMeta = {
        branch_creation: { label: 'Run Creation', color: 'purple', Icon: GitBranch },
        asset_population: { label: 'Asset Population', color: 'blue', Icon: Users },
        branch_ending: { label: 'Run Ending', color: 'rose', Icon: XCircle },
      }[ruleBuilderMode]

      return (
        <div className="space-y-4">
          {/* Back navigation */}
          <button
            type="button"
            onClick={handleExitRuleBuilder}
            className="flex items-center space-x-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors -mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Automation</span>
          </button>

          {/* Context badge */}
          <div className="flex items-center space-x-2">
            <categoryMeta.Icon className={`w-4 h-4 text-${categoryMeta.color}-500`} />
            <span className="text-[13px] font-semibold text-gray-900">New {categoryMeta.label} Rule</span>
          </div>

          {/* Embedded form */}
          {ruleBuilderMode === 'branch_creation' && (
            <AddRuleModal
              embedded
              workflowId=""
              workflowName={basicInfo.name || 'New Process'}
              workflowStages={stages}
              cadenceTimeframe={basicInfo.cadence_timeframe}
              onClose={handleExitRuleBuilder}
              onSave={handleSaveBranchRule}
              onDirtyChange={handleRuleDirtyChange}
            />
          )}
          {ruleBuilderMode === 'asset_population' && (
            <AddAssetPopulationRuleModal
              embedded
              workflowId=""
              workflowName={basicInfo.name || 'New Process'}
              workflowStages={stages}
              onClose={handleExitRuleBuilder}
              onSave={handleSaveAssetRule}
              onDirtyChange={handleRuleDirtyChange}
            />
          )}
          {ruleBuilderMode === 'branch_ending' && (
            <AddBranchEndingRuleModal
              embedded
              workflowId=""
              workflowName={basicInfo.name || 'New Process'}
              onClose={handleExitRuleBuilder}
              onSave={handleSaveBranchEndingRule}
              onDirtyChange={handleRuleDirtyChange}
            />
          )}
        </div>
      )
    }

    // ─── Rules Overview ─────────────────────────────────────
    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Automation & Triggers</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {scopeType === 'asset'
              ? 'Define when runs start, how assets are added, and when runs complete.'
              : 'Define when runs start and when they complete.'}
          </p>
        </div>

        {/* ─── Run Creation Rules ───────────────────────────── */}
        <div className="rounded-lg border border-gray-200/80 bg-white overflow-hidden">
          <div className="border-l-[3px] border-l-purple-400">
            <div className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center space-x-2.5">
                <GitBranch className="w-4 h-4 text-purple-500" />
                <div>
                  <h4 className="text-[13px] font-semibold text-gray-900">Run Creation</h4>
                  <p className="text-[11px] text-gray-400">Controls how new runs are created.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={openBranchRuleModal}
                className="text-[11px] font-medium text-gray-400 hover:text-purple-600 px-2 py-1 rounded-md hover:bg-purple-50 transition-colors"
              >
                {branchRules.length === 0 && <Plus className="w-3 h-3 inline mr-1" />}
                Add rule
              </button>
            </div>

            {branchRules.length > 0 ? (
              <div className="px-5 pb-3.5 space-y-1">
                {branchRules.map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between px-3 py-2.5 rounded-md group hover:bg-gray-50 transition-colors">
                    <div className="min-w-0">
                      <div className="text-[13px] text-gray-700">{getRuleDescription(rule)}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{rule.name}</div>
                    </div>
                    <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                      {!rule.isActive && (
                        <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Inactive</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setAutomationRules(automationRules.filter(r => r.id !== rule.id))}
                        className="text-gray-300 hover:text-red-500 p-1 rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                        aria-label={`Remove rule ${rule.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 pb-3.5">
                <p className="text-[11px] text-gray-400 py-2">Runs will only be created manually.</p>
              </div>
            )}
          </div>
        </div>

        {/* ─── Asset Population Rules ──────────────────────── */}
        {scopeType === 'asset' && (
          <div className="rounded-lg border border-gray-200/80 bg-white overflow-hidden">
            <div className="border-l-[3px] border-l-blue-400">
              <div className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center space-x-2.5">
                  <Users className="w-4 h-4 text-blue-500" />
                  <div>
                    <h4 className="text-[13px] font-semibold text-gray-900">Asset Population</h4>
                    <p className="text-[11px] text-gray-400">Controls how assets enter each run.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openAssetRuleModal}
                  className="text-[11px] font-medium text-gray-400 hover:text-blue-600 px-2 py-1 rounded-md hover:bg-blue-50 transition-colors"
                >
                  {assetRules.length === 0 && <Plus className="w-3 h-3 inline mr-1" />}
                  Add rule
                </button>
              </div>

              {assetRules.length > 0 ? (
                <div className="px-5 pb-3.5 space-y-1">
                  {assetRules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between px-3 py-2.5 rounded-md group hover:bg-gray-50 transition-colors">
                      <div className="min-w-0">
                        <div className="text-[13px] text-gray-700">{getRuleDescription(rule)}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">{rule.name}</div>
                      </div>
                      <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                        {!rule.isActive && (
                          <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Inactive</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setAutomationRules(automationRules.filter(r => r.id !== rule.id))}
                          className="text-gray-300 hover:text-red-500 p-1 rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                          aria-label={`Remove rule ${rule.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 pb-3.5">
                  <p className="text-[11px] text-gray-400 py-2">Assets will be added when each run starts.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Run Ending Rules ────────────────────────────── */}
        <div className="rounded-lg border border-gray-200/80 bg-white overflow-hidden">
          <div className="border-l-[3px] border-l-rose-400">
            <div className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center space-x-2.5">
                <XCircle className="w-4 h-4 text-rose-500" />
                <div>
                  <h4 className="text-[13px] font-semibold text-gray-900">Run Ending</h4>
                  <p className="text-[11px] text-gray-400">Controls how and when runs close.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={openBranchEndingRuleModal}
                className="text-[11px] font-medium text-gray-400 hover:text-rose-600 px-2 py-1 rounded-md hover:bg-rose-50 transition-colors"
              >
                {endingRules.length === 0 && <Plus className="w-3 h-3 inline mr-1" />}
                Add rule
              </button>
            </div>

            {endingRules.length > 0 ? (
              <div className="px-5 pb-3.5 space-y-1">
                {endingRules.map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between px-3 py-2.5 rounded-md group hover:bg-gray-50 transition-colors">
                    <div className="min-w-0">
                      <div className="text-[13px] text-gray-700">{getRuleDescription(rule)}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{rule.name}</div>
                    </div>
                    <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                      {!rule.isActive && (
                        <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Inactive</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setAutomationRules(automationRules.filter(r => r.id !== rule.id))}
                        className="text-gray-300 hover:text-red-500 p-1 rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                        aria-label={`Remove rule ${rule.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 pb-3.5">
                <p className="text-[11px] text-gray-400 py-2">Runs must be closed manually.</p>
              </div>
            )}
          </div>
        </div>

        {/* ─── Summary ───────────────────────────────────────── */}
        {totalRules > 0 && (
          <p className="text-[11px] text-gray-400">
            {totalRules} {totalRules === 1 ? 'rule' : 'rules'} configured.
          </p>
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
            <h2 className="text-xl font-semibold text-gray-900">Define New Process</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {currentStep === 0
                ? 'Define the structural foundation of this process.'
                : `Step ${currentStep + 1} of ${STEPS.length}`}
            </p>
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
                    } ${index > currentStep ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : isCompleted
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-200 text-gray-600'
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
        <div className="px-6 py-4 border-t border-gray-200 flex-shrink-0 bg-gray-50">
          {/* Error Message */}
          {submitError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">{submitError}</div>
            </div>
          )}

          {/* Warning when stages are missing on final step */}
          {currentStep === STEPS.length - 1 && stages.length === 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start space-x-2">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                You need to add at least one stage before creating the workflow.
                <button
                  type="button"
                  onClick={() => setCurrentStep(STEPS.findIndex(s => s.id === 'stages'))}
                  className="ml-1 text-amber-900 underline hover:no-underline font-medium"
                >
                  Go to Stages step
                </button>
              </div>
            </div>
          )}

          {/* ─── Rule Builder footer (Cancel / Create Rule) ─── */}
          {STEPS[currentStep]?.id === 'automation' && ruleBuilderMode ? (
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                onClick={handleExitRuleBuilder}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form={{
                  branch_creation: 'add-rule-form',
                  asset_population: 'add-asset-population-rule-form',
                  branch_ending: 'add-branch-ending-rule-form',
                }[ruleBuilderMode]}
              >
                <Plus className="w-4 h-4 mr-1" />
                Create Rule
              </Button>
            </div>
          ) : (
            /* ─── Standard wizard footer ─────────────────────── */
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                onClick={() => currentStep > 0 ? setCurrentStep(currentStep - 1) : onClose()}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                {currentStep === 0 ? 'Cancel' : 'Back'}
              </Button>

              <div className="flex items-center space-x-3">
                {/* Inline hint when stages step is blocked */}
                {STEPS[currentStep]?.id === 'stages' && !isStepValid(currentStep) && (
                  <p className="text-[11px] text-gray-400 mr-1">Define at least one stage to continue.</p>
                )}
                {/* CTA helper on final step */}
                {STEPS[currentStep]?.id === 'automation' && (
                  <p className="text-[11px] text-gray-400 mr-1">You can edit automation rules after creation.</p>
                )}
                {currentStep < STEPS.length - 1 ? (
                  <Button
                    onClick={() => {
                      if (currentStep === 0 && !isStepValid(0)) {
                        // Escalate to error state and focus the name field
                        setContinueAttempted(true)
                        nameInputRef.current?.focus()
                        return
                      }
                      setCurrentStep(currentStep + 1)
                    }}
                    disabled={currentStep !== 0 && !isStepValid(currentStep)}
                  >
                    {(() => {
                      const nextStepLabel = STEPS[currentStep + 1]?.label
                      const label = currentStep === 0 ? 'Continue to Access'
                        : nextStepLabel ? `Continue to ${nextStepLabel}`
                        : 'Next'
                      return (
                        <>
                          {label}
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </>
                      )
                    })()}
                  </Button>
                ) : (
                  <Button
                    onClick={handleSubmit}
                    disabled={isSubmitting || !isStepValid(currentStep) || stages.length === 0}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-1" />
                        Create Process
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
