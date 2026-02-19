/**
 * Field Type Registry
 *
 * Single source of truth for:
 *  - Every user-creatable field type
 *  - Zod config / value schemas for configurable types
 *  - Default configs
 *  - The Widget Gallery definition (categories, icons, example uses)
 *
 * No DB migration needed — config lives in `research_fields.config`
 * (JSONB) and values live in `field_contributions.metadata` (JSONB).
 */

import { z } from 'zod'

// ============================================================================
// FEATURE FLAGS
// ============================================================================

export const ENABLE_FIELD_GROUPS = false

// ============================================================================
// CONFIG SCHEMAS  (stored in research_fields.config)
// ============================================================================

export const singleSelectConfigSchema = z.object({
  options: z.array(z.string().min(1)).min(1, 'At least one option is required'),
})

export const multiSelectConfigSchema = z.object({
  options: z.array(z.string().min(1)).min(1, 'At least one option is required'),
  max_selections: z.number().int().positive().optional(),
})

export const booleanConfigSchema = z.object({
  true_label: z.string().optional(),
  false_label: z.string().optional(),
})

export const ratingConfigSchema = z.object({
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(1).max(10).optional(),
  step: z.number().positive().optional(),
  labels: z
    .array(z.object({ value: z.number(), label: z.string() }))
    .optional(),
})

export const percentageConfigSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  decimals: z.number().int().min(0).max(6).optional(),
})

export const currencyConfigSchema = z.object({
  currency_code: z.string().min(1).max(3).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
})

export const tableConfigSchema = z.object({
  columns: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        type: z.enum(['text', 'number']),
      }),
    )
    .min(1, 'At least one column is required'),
})

export const scenarioConfigSchema = z.object({
  scenarios: z
    .array(z.object({ key: z.string().min(1), label: z.string().min(1) }))
    .min(1, 'At least one scenario is required'),
  metrics: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        type: z.enum(['number', 'percentage', 'currency', 'text']),
      }),
    )
    .min(1, 'At least one metric is required'),
})

export const chartConfigSchema = z.object({
  chart_type: z.enum(['line', 'bar', 'area']).default('line'),
  metric: z.string().min(1).default('Value'),
  color: z.string().optional(),
})

// ── Composite container ──

const compositeWidgetSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().min(1),
  config: z.record(z.unknown()).default({}),
  linked_field_id: z.string().optional(),
})

const compositeLayoutItemSchema = z.object({
  i: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
})

export const compositeConfigSchema = z
  .object({
    widgets: z.array(compositeWidgetSchema).min(1, 'At least one widget is required'),
    layout: z.array(compositeLayoutItemSchema).min(1, 'Layout is required'),
    cols: z.number().int().min(1).default(12),
  })
  .refine(
    (cfg) => {
      const widgetIds = new Set(cfg.widgets.map((w) => w.id))
      return cfg.layout.every((l) => widgetIds.has(l.i))
    },
    { message: 'Every layout item must reference a valid widget id' },
  )
  .refine(
    (cfg) => {
      const ids = cfg.widgets.map((w) => w.id)
      return new Set(ids).size === ids.length
    },
    { message: 'Widget IDs must be unique' },
  )

// ============================================================================
// VALUE SCHEMAS  (stored in field_contributions.metadata)
// ============================================================================

export const singleSelectValueSchema = z.object({
  selected: z.string(),
})

export const multiSelectValueSchema = z.object({
  selected: z.array(z.string()),
})

export const booleanValueSchema = z.object({
  value: z.boolean(),
})

export const ratingValueSchema = z.object({
  value: z.number(),
})

export const percentageValueSchema = z.object({
  value: z.number(),
})

export const currencyValueSchema = z.object({
  value: z.number(),
  currency: z.string(),
})

export const tableValueSchema = z.object({
  rows: z.array(z.record(z.union([z.string(), z.number()]))),
})

export const scenarioValueSchema = z.object({
  values: z.record(z.record(z.union([z.string(), z.number()]))),
  probabilities: z.record(z.number()).optional(),
})

export const chartValueSchema = z.object({
  data_points: z.array(z.object({
    label: z.string(),
    value: z.number(),
  })),
})

// ============================================================================
// TYPES
// ============================================================================

export type SingleSelectConfig = z.infer<typeof singleSelectConfigSchema>
export type MultiSelectConfig = z.infer<typeof multiSelectConfigSchema>
export type BooleanConfig = z.infer<typeof booleanConfigSchema>
export type RatingConfig = z.infer<typeof ratingConfigSchema>
export type PercentageConfig = z.infer<typeof percentageConfigSchema>
export type CurrencyConfig = z.infer<typeof currencyConfigSchema>
export type TableConfig = z.infer<typeof tableConfigSchema>
export type ScenarioConfig = z.infer<typeof scenarioConfigSchema>
export type ChartConfig = z.infer<typeof chartConfigSchema>

export interface CompositeWidget {
  id: string
  type: string
  label: string
  config: Record<string, unknown>
  linked_field_id?: string
}

export interface CompositeFieldConfig {
  widgets: CompositeWidget[]
  layout: Array<{ i: string; x: number; y: number; w: number; h: number }>
  cols: number
}

export type ConfigurableFieldType =
  | 'single_select'
  | 'multi_select'
  | 'boolean'
  | 'rating'
  | 'percentage'
  | 'currency'
  | 'table'
  | 'scenario'
  | 'chart'

export interface FieldTypeRegistryEntry {
  configSchema: z.ZodType
  valueSchema: z.ZodType
  defaultConfig: Record<string, unknown>
  label: string
  icon: string
  description: string
  category: WidgetCategory
}

// ============================================================================
// DEFAULT CONFIGS
// ============================================================================

const DEFAULT_CONFIGS: Record<ConfigurableFieldType, Record<string, unknown>> = {
  single_select: { options: ['Option 1', 'Option 2', 'Option 3'] },
  multi_select: { options: ['Tag 1', 'Tag 2', 'Tag 3'] },
  boolean: { true_label: 'Yes', false_label: 'No' },
  rating: { min: 1, max: 5, step: 1 },
  percentage: { min: 0, max: 100, decimals: 1 },
  currency: { currency_code: 'USD', decimals: 2 },
  table: {
    columns: [
      { key: 'col1', label: 'Column 1', type: 'text' },
      { key: 'col2', label: 'Column 2', type: 'number' },
    ],
  },
  scenario: {
    scenarios: [
      { key: 'bear', label: 'Bear' },
      { key: 'base', label: 'Base' },
      { key: 'bull', label: 'Bull' },
    ],
    metrics: [
      { key: 'price_target', label: 'Price Target', type: 'currency' },
      { key: 'probability', label: 'Probability', type: 'percentage' },
    ],
  },
  chart: { chart_type: 'line', metric: 'Value' },
}

// ============================================================================
// CONFIGURABLE FIELD TYPE REGISTRY
// ============================================================================

export const FIELD_TYPE_REGISTRY: Record<ConfigurableFieldType, FieldTypeRegistryEntry> = {
  single_select: {
    configSchema: singleSelectConfigSchema,
    valueSchema: singleSelectValueSchema,
    defaultConfig: DEFAULT_CONFIGS.single_select,
    label: 'Single Select',
    icon: 'List',
    description: 'Pick one option from a list',
    category: 'categorical',
  },
  multi_select: {
    configSchema: multiSelectConfigSchema,
    valueSchema: multiSelectValueSchema,
    defaultConfig: DEFAULT_CONFIGS.multi_select,
    label: 'Multi Select',
    icon: 'ListChecks',
    description: 'Pick multiple options from a list',
    category: 'categorical',
  },
  boolean: {
    configSchema: booleanConfigSchema,
    valueSchema: booleanValueSchema,
    defaultConfig: DEFAULT_CONFIGS.boolean,
    label: 'Boolean',
    icon: 'ToggleLeft',
    description: 'Yes / No toggle',
    category: 'categorical',
  },
  rating: {
    configSchema: ratingConfigSchema,
    valueSchema: ratingValueSchema,
    defaultConfig: DEFAULT_CONFIGS.rating,
    label: 'Rating',
    icon: 'Star',
    description: 'Star or numeric rating',
    category: 'categorical',
  },
  percentage: {
    configSchema: percentageConfigSchema,
    valueSchema: percentageValueSchema,
    defaultConfig: DEFAULT_CONFIGS.percentage,
    label: 'Percentage',
    icon: 'Percent',
    description: 'Percentage value with optional range',
    category: 'quant',
  },
  currency: {
    configSchema: currencyConfigSchema,
    valueSchema: currencyValueSchema,
    defaultConfig: DEFAULT_CONFIGS.currency,
    label: 'Currency',
    icon: 'DollarSign',
    description: 'Monetary value with currency code',
    category: 'quant',
  },
  table: {
    configSchema: tableConfigSchema,
    valueSchema: tableValueSchema,
    defaultConfig: DEFAULT_CONFIGS.table,
    label: 'Data Table',
    icon: 'Table2',
    description: 'Tabular data with typed columns',
    category: 'structured',
  },
  scenario: {
    configSchema: scenarioConfigSchema,
    valueSchema: scenarioValueSchema,
    defaultConfig: DEFAULT_CONFIGS.scenario,
    label: 'Scenario Analysis',
    icon: 'GitBranch',
    description: 'Compare bear / base / bull outcomes',
    category: 'structured',
  },
  chart: {
    configSchema: chartConfigSchema,
    valueSchema: chartValueSchema,
    defaultConfig: DEFAULT_CONFIGS.chart,
    label: 'Chart',
    icon: 'BarChart3',
    description: 'Configurable line, bar, or area chart',
    category: 'quant',
  },
}

// ============================================================================
// WIDGET GALLERY  (categories + all user-creatable field types)
// ============================================================================

export type WidgetCategory = 'narrative' | 'quant' | 'categorical' | 'structured' | 'time'

export interface WidgetGalleryItem {
  value: string
  label: string
  description: string
  example: string
  icon: string
  hasConfig: boolean
}

export interface WidgetGalleryCategory {
  key: WidgetCategory
  label: string
  items: WidgetGalleryItem[]
}

export const COMPOSITE_GALLERY_ITEM: WidgetGalleryItem = {
  value: 'composite',
  label: 'Custom Container',
  description: 'Container with multiple widgets in a resizable grid',
  example: 'Valuation: thesis + price target + EV/EBITDA',
  icon: 'LayoutGrid',
  hasConfig: false,
}

export const WIDGET_GALLERY: WidgetGalleryCategory[] = [
  {
    key: 'narrative',
    label: 'Narrative',
    items: [
      { value: 'rich_text', label: 'Rich Text', description: 'Formatted text with headings, lists, and links', example: 'Investment thesis, notes', icon: 'FileText', hasConfig: false },
      { value: 'checklist', label: 'Checklist', description: 'Track items with checkboxes', example: 'Due diligence checklist', icon: 'CheckSquare', hasConfig: false },
    ],
  },
  {
    key: 'quant',
    label: 'Quantitative',
    items: [
      { value: 'numeric', label: 'Numeric', description: 'Single number value', example: 'EV/EBITDA, P/E ratio', icon: 'Hash', hasConfig: false },
      { value: 'percentage', label: 'Percentage', description: 'Percentage with optional range', example: 'Upside potential, probability', icon: 'Percent', hasConfig: true },
      { value: 'currency', label: 'Currency', description: 'Monetary value with currency code', example: 'Price target, market cap', icon: 'DollarSign', hasConfig: true },
      { value: 'metric', label: 'Metric', description: 'Track a KPI with change over time', example: 'Revenue growth, margins', icon: 'Gauge', hasConfig: false },
      { value: 'chart', label: 'Chart', description: 'Line, bar, or area chart for a metric', example: 'Revenue trend, price history', icon: 'BarChart3', hasConfig: true },
    ],
  },
  {
    key: 'categorical',
    label: 'Categorical',
    items: [
      { value: 'single_select', label: 'Single Select', description: 'Pick one option from a list', example: 'Conviction level, sector', icon: 'List', hasConfig: true },
      { value: 'multi_select', label: 'Multi Select', description: 'Pick multiple options', example: 'Themes, catalysts', icon: 'ListChecks', hasConfig: true },
      { value: 'boolean', label: 'Boolean', description: 'Yes / No toggle', example: 'Dividend payer, ESG compliant', icon: 'ToggleLeft', hasConfig: true },
      { value: 'rating', label: 'Rating', description: 'Star or numeric rating', example: 'Management quality, moat', icon: 'Star', hasConfig: true },
    ],
  },
  {
    key: 'structured',
    label: 'Structured',
    items: [
      { value: 'table', label: 'Data Table', description: 'Tabular data with typed columns', example: 'Comp table, segment data', icon: 'Table2', hasConfig: true },
      { value: 'scenario', label: 'Scenario Analysis', description: 'Compare bear / base / bull outcomes', example: 'Valuation scenarios', icon: 'GitBranch', hasConfig: true },
    ],
  },
  {
    key: 'time',
    label: 'Time',
    items: [
      { value: 'date', label: 'Date', description: 'Date picker field', example: 'Earnings date, catalyst date', icon: 'Calendar', hasConfig: false },
      { value: 'timeline', label: 'Timeline', description: 'Events and milestones over time', example: 'Catalyst calendar', icon: 'Clock', hasConfig: false },
    ],
  },
]

/** Flat lookup: type string → gallery item */
export const WIDGET_GALLERY_MAP: Record<string, WidgetGalleryItem> = Object.fromEntries(
  WIDGET_GALLERY.flatMap(cat => cat.items.map(item => [item.value, item])),
)

// ============================================================================
// HELPERS
// ============================================================================

export function getDefaultConfig(fieldType: string): Record<string, unknown> {
  return DEFAULT_CONFIGS[fieldType as ConfigurableFieldType] ?? {}
}

export function isConfigurableFieldType(type: string): type is ConfigurableFieldType {
  return type in FIELD_TYPE_REGISTRY
}

export function validateFieldConfig(
  type: string,
  config: unknown,
): { success: true; data: unknown } | { success: false; error: z.ZodError } {
  const entry = FIELD_TYPE_REGISTRY[type as ConfigurableFieldType]
  if (!entry) return { success: true, data: config }
  const result = entry.configSchema.safeParse(config)
  if (result.success) return { success: true, data: result.data }
  return { success: false, error: result.error }
}

export function validateFieldValue(
  type: string,
  value: unknown,
): { success: true; data: unknown } | { success: false; error: z.ZodError } {
  const entry = FIELD_TYPE_REGISTRY[type as ConfigurableFieldType]
  if (!entry) return { success: true, data: value }
  const result = entry.valueSchema.safeParse(value)
  if (result.success) return { success: true, data: result.data }
  return { success: false, error: result.error }
}

/** Max field name length (enforced in UI) */
export const FIELD_NAME_MAX_LENGTH = 80
