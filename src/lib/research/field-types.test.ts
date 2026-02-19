import { describe, it, expect } from 'vitest'
import {
  singleSelectConfigSchema,
  multiSelectConfigSchema,
  booleanConfigSchema,
  ratingConfigSchema,
  percentageConfigSchema,
  currencyConfigSchema,
  tableConfigSchema,
  scenarioConfigSchema,
  compositeConfigSchema,
  singleSelectValueSchema,
  multiSelectValueSchema,
  booleanValueSchema,
  ratingValueSchema,
  percentageValueSchema,
  currencyValueSchema,
  tableValueSchema,
  scenarioValueSchema,
  getDefaultConfig,
  validateFieldConfig,
  validateFieldValue,
  isConfigurableFieldType,
  FIELD_TYPE_REGISTRY,
  WIDGET_GALLERY,
  WIDGET_GALLERY_MAP,
  COMPOSITE_GALLERY_ITEM,
  FIELD_NAME_MAX_LENGTH,
} from './field-types'

// ============================================================================
// CONFIG SCHEMA VALIDATION
// ============================================================================

describe('Config schemas', () => {
  describe('singleSelectConfigSchema', () => {
    it('accepts valid config', () => {
      expect(singleSelectConfigSchema.safeParse({ options: ['A', 'B'] }).success).toBe(true)
    })
    it('rejects empty options array', () => {
      expect(singleSelectConfigSchema.safeParse({ options: [] }).success).toBe(false)
    })
    it('rejects missing options', () => {
      expect(singleSelectConfigSchema.safeParse({}).success).toBe(false)
    })
    it('rejects options with empty strings', () => {
      expect(singleSelectConfigSchema.safeParse({ options: [''] }).success).toBe(false)
    })
  })

  describe('multiSelectConfigSchema', () => {
    it('accepts valid config with max_selections', () => {
      const result = multiSelectConfigSchema.safeParse({ options: ['A'], max_selections: 3 })
      expect(result.success).toBe(true)
    })
    it('accepts config without max_selections', () => {
      expect(multiSelectConfigSchema.safeParse({ options: ['A'] }).success).toBe(true)
    })
    it('rejects non-positive max_selections', () => {
      expect(multiSelectConfigSchema.safeParse({ options: ['A'], max_selections: 0 }).success).toBe(false)
    })
  })

  describe('booleanConfigSchema', () => {
    it('accepts empty config (all optional)', () => {
      expect(booleanConfigSchema.safeParse({}).success).toBe(true)
    })
    it('accepts custom labels', () => {
      expect(booleanConfigSchema.safeParse({ true_label: 'On', false_label: 'Off' }).success).toBe(true)
    })
  })

  describe('percentageConfigSchema', () => {
    it('accepts empty config', () => {
      expect(percentageConfigSchema.safeParse({}).success).toBe(true)
    })
    it('accepts full config', () => {
      expect(percentageConfigSchema.safeParse({ min: -100, max: 100, decimals: 2 }).success).toBe(true)
    })
    it('rejects negative decimals', () => {
      expect(percentageConfigSchema.safeParse({ decimals: -1 }).success).toBe(false)
    })
    it('rejects decimals > 6', () => {
      expect(percentageConfigSchema.safeParse({ decimals: 7 }).success).toBe(false)
    })
  })

  describe('currencyConfigSchema', () => {
    it('accepts valid currency code', () => {
      expect(currencyConfigSchema.safeParse({ currency_code: 'EUR', decimals: 2 }).success).toBe(true)
    })
    it('rejects currency code longer than 3', () => {
      expect(currencyConfigSchema.safeParse({ currency_code: 'ABCD' }).success).toBe(false)
    })
  })

  describe('tableConfigSchema', () => {
    it('accepts valid columns', () => {
      const config = {
        columns: [
          { key: 'name', label: 'Name', type: 'text' as const },
          { key: 'amount', label: 'Amount', type: 'number' as const },
        ],
      }
      expect(tableConfigSchema.safeParse(config).success).toBe(true)
    })
    it('rejects empty columns array', () => {
      expect(tableConfigSchema.safeParse({ columns: [] }).success).toBe(false)
    })
    it('rejects invalid column type', () => {
      expect(
        tableConfigSchema.safeParse({
          columns: [{ key: 'x', label: 'X', type: 'date' }],
        }).success,
      ).toBe(false)
    })
  })

  describe('ratingConfigSchema', () => {
    it('accepts empty config (all optional)', () => {
      expect(ratingConfigSchema.safeParse({}).success).toBe(true)
    })
    it('accepts full config with labels', () => {
      const config = {
        min: 1,
        max: 5,
        step: 1,
        labels: [
          { value: 1, label: 'Poor' },
          { value: 5, label: 'Excellent' },
        ],
      }
      expect(ratingConfigSchema.safeParse(config).success).toBe(true)
    })
    it('rejects max > 10', () => {
      expect(ratingConfigSchema.safeParse({ max: 11 }).success).toBe(false)
    })
    it('rejects max < 1', () => {
      expect(ratingConfigSchema.safeParse({ max: 0 }).success).toBe(false)
    })
  })

  describe('scenarioConfigSchema', () => {
    it('accepts valid config', () => {
      const config = {
        scenarios: [{ key: 'bear', label: 'Bear' }, { key: 'bull', label: 'Bull' }],
        metrics: [{ key: 'price', label: 'Price', type: 'currency' as const }],
      }
      expect(scenarioConfigSchema.safeParse(config).success).toBe(true)
    })
    it('rejects empty scenarios', () => {
      expect(
        scenarioConfigSchema.safeParse({
          scenarios: [],
          metrics: [{ key: 'x', label: 'X', type: 'text' }],
        }).success,
      ).toBe(false)
    })
    it('rejects empty metrics', () => {
      expect(
        scenarioConfigSchema.safeParse({
          scenarios: [{ key: 'x', label: 'X' }],
          metrics: [],
        }).success,
      ).toBe(false)
    })
    it('rejects invalid metric type', () => {
      expect(
        scenarioConfigSchema.safeParse({
          scenarios: [{ key: 'x', label: 'X' }],
          metrics: [{ key: 'x', label: 'X', type: 'boolean' }],
        }).success,
      ).toBe(false)
    })
  })
})

// ============================================================================
// VALUE SCHEMA VALIDATION
// ============================================================================

describe('Value schemas', () => {
  it('singleSelectValueSchema accepts valid value', () => {
    expect(singleSelectValueSchema.safeParse({ selected: 'Option A' }).success).toBe(true)
  })
  it('singleSelectValueSchema rejects missing selected', () => {
    expect(singleSelectValueSchema.safeParse({}).success).toBe(false)
  })

  it('multiSelectValueSchema accepts array', () => {
    expect(multiSelectValueSchema.safeParse({ selected: ['A', 'B'] }).success).toBe(true)
  })
  it('multiSelectValueSchema accepts empty array', () => {
    expect(multiSelectValueSchema.safeParse({ selected: [] }).success).toBe(true)
  })

  it('booleanValueSchema accepts boolean', () => {
    expect(booleanValueSchema.safeParse({ value: true }).success).toBe(true)
    expect(booleanValueSchema.safeParse({ value: false }).success).toBe(true)
  })

  it('percentageValueSchema accepts number', () => {
    expect(percentageValueSchema.safeParse({ value: 73.5 }).success).toBe(true)
  })
  it('percentageValueSchema accepts negative percentage', () => {
    expect(percentageValueSchema.safeParse({ value: -20 }).success).toBe(true)
  })

  it('currencyValueSchema requires currency string', () => {
    expect(currencyValueSchema.safeParse({ value: 100, currency: 'USD' }).success).toBe(true)
    expect(currencyValueSchema.safeParse({ value: 100 }).success).toBe(false)
  })

  it('tableValueSchema accepts rows', () => {
    expect(
      tableValueSchema.safeParse({
        rows: [
          { col1: 'hello', col2: 42 },
          { col1: 'world', col2: 0 },
        ],
      }).success,
    ).toBe(true)
  })
  it('tableValueSchema accepts empty rows', () => {
    expect(tableValueSchema.safeParse({ rows: [] }).success).toBe(true)
  })

  it('ratingValueSchema accepts number', () => {
    expect(ratingValueSchema.safeParse({ value: 4 }).success).toBe(true)
  })
  it('ratingValueSchema rejects string', () => {
    expect(ratingValueSchema.safeParse({ value: 'high' }).success).toBe(false)
  })

  it('scenarioValueSchema accepts valid structure', () => {
    expect(
      scenarioValueSchema.safeParse({
        values: {
          bear: { price_target: 80, probability: 0.2 },
          bull: { price_target: 150, probability: 0.5 },
        },
        probabilities: { bear: 0.2, bull: 0.5 },
      }).success,
    ).toBe(true)
  })
  it('scenarioValueSchema accepts without probabilities', () => {
    expect(
      scenarioValueSchema.safeParse({
        values: { base: { price: 100 } },
      }).success,
    ).toBe(true)
  })
})

// ============================================================================
// getDefaultConfig
// ============================================================================

describe('getDefaultConfig', () => {
  it('returns options for single_select', () => {
    const cfg = getDefaultConfig('single_select')
    expect(cfg).toHaveProperty('options')
    expect(Array.isArray(cfg.options)).toBe(true)
    expect((cfg.options as string[]).length).toBeGreaterThan(0)
  })

  it('returns columns for table', () => {
    const cfg = getDefaultConfig('table')
    expect(cfg).toHaveProperty('columns')
    expect(Array.isArray(cfg.columns)).toBe(true)
  })

  it('returns empty object for unknown type', () => {
    expect(getDefaultConfig('unknown_type')).toEqual({})
  })

  it('returns valid configs for all configurable types', () => {
    for (const type of Object.keys(FIELD_TYPE_REGISTRY)) {
      const cfg = getDefaultConfig(type)
      const result = validateFieldConfig(type, cfg)
      expect(result.success).toBe(true)
    }
  })
})

// ============================================================================
// isConfigurableFieldType
// ============================================================================

describe('isConfigurableFieldType', () => {
  it('returns true for configurable types', () => {
    expect(isConfigurableFieldType('single_select')).toBe(true)
    expect(isConfigurableFieldType('table')).toBe(true)
  })
  it('returns false for non-configurable types', () => {
    expect(isConfigurableFieldType('rich_text')).toBe(false)
    expect(isConfigurableFieldType('xyz')).toBe(false)
  })
})

// ============================================================================
// validateFieldConfig / validateFieldValue
// ============================================================================

describe('validateFieldConfig', () => {
  it('returns success for valid config', () => {
    expect(validateFieldConfig('boolean', { true_label: 'On' }).success).toBe(true)
  })
  it('returns error for invalid config', () => {
    const result = validateFieldConfig('single_select', { options: [] })
    expect(result.success).toBe(false)
  })
  it('passes through unknown types', () => {
    expect(validateFieldConfig('rich_text', { anything: true }).success).toBe(true)
  })
})

describe('validateFieldValue', () => {
  it('returns success for valid value', () => {
    expect(validateFieldValue('boolean', { value: true }).success).toBe(true)
  })
  it('returns error for invalid value', () => {
    const result = validateFieldValue('currency', { value: 'not a number' })
    expect(result.success).toBe(false)
  })
  it('passes through unknown types', () => {
    expect(validateFieldValue('rich_text', 'anything').success).toBe(true)
  })
})

// ============================================================================
// Registry completeness
// ============================================================================

describe('FIELD_TYPE_REGISTRY', () => {
  it('has entries for all 8 configurable types', () => {
    const types = ['single_select', 'multi_select', 'boolean', 'rating', 'percentage', 'currency', 'table', 'scenario']
    for (const t of types) {
      expect(FIELD_TYPE_REGISTRY).toHaveProperty(t)
      expect(FIELD_TYPE_REGISTRY[t as keyof typeof FIELD_TYPE_REGISTRY].label).toBeTruthy()
      expect(FIELD_TYPE_REGISTRY[t as keyof typeof FIELD_TYPE_REGISTRY].icon).toBeTruthy()
    }
  })
})

// ============================================================================
// WIDGET_GALLERY
// ============================================================================

describe('WIDGET_GALLERY', () => {
  it('has 5 categories', () => {
    expect(WIDGET_GALLERY).toHaveLength(5)
    const keys = WIDGET_GALLERY.map(c => c.key)
    expect(keys).toEqual(['narrative', 'quant', 'categorical', 'structured', 'time'])
  })

  it('all items have unique values', () => {
    const values = WIDGET_GALLERY.flatMap(c => c.items.map(i => i.value))
    expect(new Set(values).size).toBe(values.length)
  })

  it('WIDGET_GALLERY_MAP contains all items', () => {
    const allItems = WIDGET_GALLERY.flatMap(c => c.items)
    for (const item of allItems) {
      expect(WIDGET_GALLERY_MAP[item.value]).toBe(item)
    }
  })

  it('configurable items match FIELD_TYPE_REGISTRY', () => {
    const configurableItems = WIDGET_GALLERY.flatMap(c => c.items).filter(i => i.hasConfig)
    for (const item of configurableItems) {
      expect(isConfigurableFieldType(item.value)).toBe(true)
    }
  })
})

// ============================================================================
// FIELD_NAME_MAX_LENGTH
// ============================================================================

describe('FIELD_NAME_MAX_LENGTH', () => {
  it('is 80', () => {
    expect(FIELD_NAME_MAX_LENGTH).toBe(80)
  })
})

// ============================================================================
// COMPOSITE CONFIG SCHEMA
// ============================================================================

describe('compositeConfigSchema', () => {
  const validConfig = {
    widgets: [
      { id: 'w-1', type: 'rich_text', label: 'Thesis', config: {} },
      { id: 'w-2', type: 'currency', label: 'Price Target', config: { currency_code: 'USD' } },
    ],
    layout: [
      { i: 'w-1', x: 0, y: 0, w: 6, h: 4 },
      { i: 'w-2', x: 6, y: 0, w: 6, h: 2 },
    ],
    cols: 12,
  }

  it('accepts a valid composite config', () => {
    const result = compositeConfigSchema.safeParse(validConfig)
    expect(result.success).toBe(true)
  })

  it('rejects empty widgets array', () => {
    const result = compositeConfigSchema.safeParse({ ...validConfig, widgets: [] })
    expect(result.success).toBe(false)
  })

  it('rejects empty layout array', () => {
    const result = compositeConfigSchema.safeParse({ ...validConfig, layout: [] })
    expect(result.success).toBe(false)
  })

  it('rejects layout items referencing non-existent widget ids', () => {
    const result = compositeConfigSchema.safeParse({
      ...validConfig,
      layout: [
        { i: 'w-1', x: 0, y: 0, w: 6, h: 4 },
        { i: 'w-MISSING', x: 6, y: 0, w: 6, h: 2 },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects duplicate widget IDs', () => {
    const result = compositeConfigSchema.safeParse({
      widgets: [
        { id: 'w-dup', type: 'numeric', label: 'A', config: {} },
        { id: 'w-dup', type: 'numeric', label: 'B', config: {} },
      ],
      layout: [{ i: 'w-dup', x: 0, y: 0, w: 12, h: 2 }],
      cols: 12,
    })
    expect(result.success).toBe(false)
  })

  it('defaults cols to 12 when omitted', () => {
    const { cols: _, ...withoutCols } = validConfig
    const result = compositeConfigSchema.safeParse(withoutCols)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cols).toBe(12)
    }
  })

  it('rejects widgets with missing required fields', () => {
    const result = compositeConfigSchema.safeParse({
      ...validConfig,
      widgets: [{ id: 'w-1', type: '' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects layout items with negative coordinates', () => {
    const result = compositeConfigSchema.safeParse({
      ...validConfig,
      layout: [
        { i: 'w-1', x: -1, y: 0, w: 6, h: 4 },
        { i: 'w-2', x: 6, y: 0, w: 6, h: 2 },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects layout items with zero width or height', () => {
    const result = compositeConfigSchema.safeParse({
      ...validConfig,
      layout: [
        { i: 'w-1', x: 0, y: 0, w: 0, h: 4 },
        { i: 'w-2', x: 6, y: 0, w: 6, h: 2 },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a single-widget container', () => {
    const result = compositeConfigSchema.safeParse({
      widgets: [{ id: 'w-solo', type: 'numeric', label: 'Solo', config: {} }],
      layout: [{ i: 'w-solo', x: 0, y: 0, w: 12, h: 2 }],
      cols: 12,
    })
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// COMPOSITE_GALLERY_ITEM
// ============================================================================

describe('COMPOSITE_GALLERY_ITEM', () => {
  it('has value "composite"', () => {
    expect(COMPOSITE_GALLERY_ITEM.value).toBe('composite')
  })
  it('has icon LayoutGrid', () => {
    expect(COMPOSITE_GALLERY_ITEM.icon).toBe('LayoutGrid')
  })
})
