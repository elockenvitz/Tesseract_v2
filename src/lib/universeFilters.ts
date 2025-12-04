import {
  Users, FileText, Target, Building2, Star, DollarSign,
  Calendar, Briefcase, Globe, Tag
} from 'lucide-react'

export type FilterOperator =
  | 'includes'
  | 'excludes'
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'between'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'in_last'
  | 'before'
  | 'after'

export type FilterValueType =
  | 'single_select'
  | 'multi_select'
  | 'number'
  | 'number_range'
  | 'text'
  | 'date'
  | 'date_range'
  | 'boolean'
  | 'percentage'

export interface FilterTypeDefinition {
  id: string
  name: string
  description: string
  category: 'basic' | 'financial' | 'coverage' | 'temporal' | 'custom'
  icon: any
  color: string
  valueType: FilterValueType
  availableOperators: FilterOperator[]
  defaultOperator: FilterOperator

  // Function to get available options (for select types)
  getOptions?: (context: any) => Promise<Array<{ value: string, label: string, meta?: any }>>

  // Function to validate filter values
  validate?: (values: any) => boolean

  // Placeholder text for inputs
  placeholder?: string

  // Min/max for numeric fields
  min?: number
  max?: number
  step?: number

  // Format function for display
  formatValue?: (value: any) => string

  // Help text
  helpText?: string
}

export const FILTER_TYPE_REGISTRY: Record<string, FilterTypeDefinition> = {
  // BASIC FILTERS
  analyst: {
    id: 'analyst',
    name: 'Analyst Coverage',
    description: 'Filter by analyst covering the asset',
    category: 'coverage',
    icon: Users,
    color: 'indigo',
    valueType: 'multi_select',
    availableOperators: ['includes', 'excludes'],
    defaultOperator: 'includes',
    helpText: 'Select analysts whose coverage you want to include or exclude'
  },

  list: {
    id: 'list',
    name: 'Asset List',
    description: 'Filter by membership in asset lists',
    category: 'basic',
    icon: FileText,
    color: 'blue',
    valueType: 'multi_select',
    availableOperators: ['includes', 'excludes'],
    defaultOperator: 'includes',
    helpText: 'Include or exclude assets from specific lists'
  },

  theme: {
    id: 'theme',
    name: 'Investment Theme',
    description: 'Filter by investment themes',
    category: 'basic',
    icon: Target,
    color: 'purple',
    valueType: 'multi_select',
    availableOperators: ['includes', 'excludes'],
    defaultOperator: 'includes',
    helpText: 'Filter assets by thematic classification'
  },

  portfolio: {
    id: 'portfolio',
    name: 'Portfolio Holdings',
    description: 'Filter by portfolio membership',
    category: 'basic',
    icon: Briefcase,
    color: 'cyan',
    valueType: 'multi_select',
    availableOperators: ['includes', 'excludes'],
    defaultOperator: 'includes',
    helpText: 'Include or exclude assets held in specific portfolios'
  },

  sector: {
    id: 'sector',
    name: 'Sector',
    description: 'Filter by business sector',
    category: 'basic',
    icon: Building2,
    color: 'green',
    valueType: 'multi_select',
    availableOperators: ['includes', 'excludes'],
    defaultOperator: 'includes',
    helpText: 'Filter by standard sector classifications'
  },

  priority: {
    id: 'priority',
    name: 'Priority Level',
    description: 'Filter by assigned priority',
    category: 'basic',
    icon: Star,
    color: 'amber',
    valueType: 'multi_select',
    availableOperators: ['includes', 'excludes'],
    defaultOperator: 'includes',
    helpText: 'Filter by asset priority level (Critical, High, Medium, Low)'
  },

  // FINANCIAL METRIC FILTER (consolidated)
  financial_metric: {
    id: 'financial_metric',
    name: 'Financial Metric',
    description: 'Filter by financial metrics (Market Cap, Price, Volume, P/E, Dividend Yield)',
    category: 'financial',
    icon: DollarSign,
    color: 'emerald',
    valueType: 'number_range',
    availableOperators: ['greater_than', 'less_than', 'between'],
    defaultOperator: 'greater_than',
    placeholder: 'Enter value',
    min: 0,
    step: 0.01,
    helpText: 'Select a metric and set the value range'
  },

  // TEMPORAL FILTERS
  last_updated: {
    id: 'last_updated',
    name: 'Last Updated',
    description: 'Filter by when research was last updated',
    category: 'temporal',
    icon: Calendar,
    color: 'orange',
    valueType: 'date',
    availableOperators: ['in_last', 'before', 'after', 'between'],
    defaultOperator: 'in_last',
    helpText: 'Filter by when the asset was last updated'
  },

  // GEOGRAPHIC FILTERS
  country: {
    id: 'country',
    name: 'Country',
    description: 'Filter by country of incorporation',
    category: 'basic',
    icon: Globe,
    color: 'sky',
    valueType: 'multi_select',
    availableOperators: ['includes', 'excludes'],
    defaultOperator: 'includes',
    helpText: 'Filter by country of incorporation or headquarters'
  }
}

// Filter categories for organization
export const FILTER_CATEGORIES = [
  { id: 'basic', name: 'Basic Filters', icon: FileText, color: 'blue' },
  { id: 'financial', name: 'Financial Metrics', icon: DollarSign, color: 'green' },
  { id: 'coverage', name: 'Coverage & Research', icon: Users, color: 'indigo' },
  { id: 'temporal', name: 'Date & Time', icon: Calendar, color: 'orange' },
  { id: 'custom', name: 'Custom Fields', icon: Tag, color: 'purple' }
] as const

// Operator labels
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  includes: 'Includes',
  excludes: 'Excludes',
  equals: 'Equals',
  not_equals: 'Does Not Equal',
  greater_than: 'Greater Than',
  less_than: 'Less Than',
  between: 'Between',
  contains: 'Contains',
  starts_with: 'Starts With',
  ends_with: 'Ends With',
  is_empty: 'Is Empty',
  is_not_empty: 'Is Not Empty',
  in_last: 'In Last',
  before: 'Before',
  after: 'After'
}

// Helper function to get filter definition
export function getFilterDefinition(filterId: string): FilterTypeDefinition | undefined {
  return FILTER_TYPE_REGISTRY[filterId]
}

// Helper function to get filters by category
export function getFiltersByCategory(category: string): FilterTypeDefinition[] {
  return Object.values(FILTER_TYPE_REGISTRY).filter(f => f.category === category)
}

// Helper function to validate a filter rule
export function validateFilterRule(rule: any): { valid: boolean; error?: string } {
  const definition = getFilterDefinition(rule.type)

  if (!definition) {
    return { valid: false, error: 'Unknown filter type' }
  }

  if (!definition.availableOperators.includes(rule.operator)) {
    return { valid: false, error: 'Invalid operator for this filter type' }
  }

  if (definition.validate && !definition.validate(rule.values)) {
    return { valid: false, error: 'Invalid filter values' }
  }

  return { valid: true }
}
