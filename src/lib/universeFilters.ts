import {
  Users, FileText, Target, Building2, Star, DollarSign,
  TrendingUp, Calendar, Briefcase, Hash, Tag, BarChart3,
  Activity, Globe, MapPin, User
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
    availableOperators: ['includes', 'excludes', 'equals', 'not_equals'],
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
    availableOperators: ['includes', 'excludes', 'equals'],
    defaultOperator: 'includes',
    helpText: 'Filter by asset priority level (Critical, High, Medium, Low)'
  },

  // FINANCIAL FILTERS
  market_cap: {
    id: 'market_cap',
    name: 'Market Cap',
    description: 'Filter by market capitalization',
    category: 'financial',
    icon: DollarSign,
    color: 'emerald',
    valueType: 'number_range',
    availableOperators: ['between', 'greater_than', 'less_than', 'equals'],
    defaultOperator: 'between',
    placeholder: 'Enter value in millions',
    min: 0,
    step: 100,
    formatValue: (val) => `$${val}M`,
    helpText: 'Filter by market capitalization range (in millions)'
  },

  price: {
    id: 'price',
    name: 'Stock Price',
    description: 'Filter by current stock price',
    category: 'financial',
    icon: TrendingUp,
    color: 'green',
    valueType: 'number_range',
    availableOperators: ['between', 'greater_than', 'less_than', 'equals'],
    defaultOperator: 'between',
    placeholder: 'Enter price',
    min: 0,
    step: 0.01,
    formatValue: (val) => `$${val}`,
    helpText: 'Filter by stock price range'
  },

  volume: {
    id: 'volume',
    name: 'Trading Volume',
    description: 'Filter by average daily volume',
    category: 'financial',
    icon: Activity,
    color: 'blue',
    valueType: 'number_range',
    availableOperators: ['between', 'greater_than', 'less_than'],
    defaultOperator: 'greater_than',
    placeholder: 'Enter volume',
    min: 0,
    step: 1000,
    formatValue: (val) => val.toLocaleString(),
    helpText: 'Filter by average daily trading volume'
  },

  pe_ratio: {
    id: 'pe_ratio',
    name: 'P/E Ratio',
    description: 'Filter by price-to-earnings ratio',
    category: 'financial',
    icon: BarChart3,
    color: 'violet',
    valueType: 'number_range',
    availableOperators: ['between', 'greater_than', 'less_than', 'equals'],
    defaultOperator: 'between',
    placeholder: 'Enter P/E ratio',
    min: 0,
    step: 0.1,
    helpText: 'Filter by P/E ratio range'
  },

  dividend_yield: {
    id: 'dividend_yield',
    name: 'Dividend Yield',
    description: 'Filter by dividend yield percentage',
    category: 'financial',
    icon: DollarSign,
    color: 'teal',
    valueType: 'percentage',
    availableOperators: ['between', 'greater_than', 'less_than'],
    defaultOperator: 'greater_than',
    placeholder: 'Enter percentage',
    min: 0,
    max: 100,
    step: 0.1,
    formatValue: (val) => `${val}%`,
    helpText: 'Filter by dividend yield percentage'
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

  coverage_start: {
    id: 'coverage_start',
    name: 'Coverage Start Date',
    description: 'Filter by when coverage began',
    category: 'temporal',
    icon: Calendar,
    color: 'pink',
    valueType: 'date',
    availableOperators: ['before', 'after', 'between'],
    defaultOperator: 'after',
    helpText: 'Filter by coverage initiation date'
  },

  // COVERAGE QUALITY FILTERS
  has_notes: {
    id: 'has_notes',
    name: 'Has Research Notes',
    description: 'Assets with or without research notes',
    category: 'coverage',
    icon: FileText,
    color: 'slate',
    valueType: 'boolean',
    availableOperators: ['equals'],
    defaultOperator: 'equals',
    helpText: 'Filter assets that have research notes'
  },

  workflow_stage: {
    id: 'workflow_stage',
    name: 'Workflow Stage',
    description: 'Filter by current workflow stage',
    category: 'coverage',
    icon: Activity,
    color: 'indigo',
    valueType: 'multi_select',
    availableOperators: ['includes', 'excludes', 'equals'],
    defaultOperator: 'includes',
    helpText: 'Filter by which workflow stage assets are in'
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
    availableOperators: ['includes', 'excludes', 'equals'],
    defaultOperator: 'includes',
    helpText: 'Filter by country of incorporation or headquarters'
  },

  exchange: {
    id: 'exchange',
    name: 'Stock Exchange',
    description: 'Filter by listing exchange',
    category: 'basic',
    icon: Building2,
    color: 'cyan',
    valueType: 'multi_select',
    availableOperators: ['includes', 'excludes', 'equals'],
    defaultOperator: 'includes',
    helpText: 'Filter by stock exchange (NYSE, NASDAQ, etc.)'
  },

  // CUSTOM FIELD FILTERS
  custom_tag: {
    id: 'custom_tag',
    name: 'Custom Tags',
    description: 'Filter by custom tags',
    category: 'custom',
    icon: Tag,
    color: 'fuchsia',
    valueType: 'multi_select',
    availableOperators: ['includes', 'excludes', 'contains'],
    defaultOperator: 'includes',
    helpText: 'Filter by user-defined tags'
  },

  symbol: {
    id: 'symbol',
    name: 'Symbol/Ticker',
    description: 'Filter by stock symbol',
    category: 'basic',
    icon: Hash,
    color: 'gray',
    valueType: 'multi_select',
    availableOperators: ['includes', 'excludes'],
    defaultOperator: 'includes',
    placeholder: 'Type ticker symbols...',
    helpText: 'Include or exclude specific ticker symbols'
  },

  company_name: {
    id: 'company_name',
    name: 'Company Name',
    description: 'Filter by company name',
    category: 'basic',
    icon: Building2,
    color: 'gray',
    valueType: 'text',
    availableOperators: ['contains', 'starts_with', 'equals'],
    defaultOperator: 'contains',
    placeholder: 'Enter company name',
    helpText: 'Search by company name'
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
