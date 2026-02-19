import { describe, it, expect } from 'vitest'
import {
  resolveLayout,
  normalizePresetFieldId,
  extractPresetSlug,
  fieldConfigMatchesField,
  toCanonicalPresetId,
  type ResolveLayoutInput,
  type AvailableField,
  type SectionInfo,
  type LayoutTemplate,
  type AssetLayoutSelection
} from './layout-resolver'

// ============================================================================
// TEST HELPERS
// ============================================================================

function makeSection(overrides: Partial<SectionInfo> = {}): SectionInfo {
  return {
    id: 'section-1',
    name: 'Thesis',
    slug: 'thesis',
    display_order: 0,
    is_system: true,
    ...overrides
  }
}

function makeField(overrides: Partial<AvailableField> = {}): AvailableField {
  const section = makeSection()
  return {
    id: 'field-1',
    name: 'Investment Thesis',
    slug: 'investment_thesis',
    description: null,
    field_type: 'rich_text',
    section_id: section.id,
    is_universal: true,
    is_system: true,
    display_order: 0,
    created_by: null,
    created_at: null,
    research_sections: section,
    ...overrides
  }
}

function makeTemplate(overrides: Partial<LayoutTemplate> = {}): LayoutTemplate {
  return {
    id: 'template-1',
    name: 'My Template',
    is_default: false,
    field_config: [],
    ...overrides
  }
}

// ============================================================================
// PRESET FIELD MATCHING
// ============================================================================

describe('normalizePresetFieldId', () => {
  it('strips timestamp from preset IDs', () => {
    expect(normalizePresetFieldId('preset-competitive_landscape-1768168549905'))
      .toBe('preset-competitive_landscape')
  })

  it('leaves non-timestamped preset IDs unchanged', () => {
    expect(normalizePresetFieldId('preset-competitive_landscape'))
      .toBe('preset-competitive_landscape')
  })

  it('leaves regular UUIDs unchanged', () => {
    expect(normalizePresetFieldId('abc-def-123'))
      .toBe('abc-def-123')
  })
})

describe('extractPresetSlug', () => {
  it('extracts slug from timestamped preset ID', () => {
    expect(extractPresetSlug('preset-competitive_landscape-1768168549905'))
      .toBe('competitive_landscape')
  })

  it('extracts slug from non-timestamped preset ID', () => {
    expect(extractPresetSlug('preset-competitive_landscape'))
      .toBe('competitive_landscape')
  })

  it('returns null for non-preset IDs', () => {
    expect(extractPresetSlug('regular-uuid-123')).toBeNull()
  })
})

describe('fieldConfigMatchesField', () => {
  it('matches by direct ID', () => {
    expect(fieldConfigMatchesField(
      { field_id: 'field-1' },
      { id: 'field-1', slug: 'thesis' }
    )).toBe(true)
  })

  it('matches preset by slug', () => {
    expect(fieldConfigMatchesField(
      { field_id: 'preset-competitive_landscape-1768168549905' },
      { id: 'preset-competitive_landscape', slug: 'competitive_landscape' }
    )).toBe(true)
  })

  it('does not match unrelated fields', () => {
    expect(fieldConfigMatchesField(
      { field_id: 'field-1' },
      { id: 'field-2', slug: 'other' }
    )).toBe(false)
  })
})

// ============================================================================
// RESOLUTION PRECEDENCE
// ============================================================================

describe('resolveLayout', () => {
  const section = makeSection()
  const universalField = makeField({ id: 'f-uni', slug: 'thesis', is_universal: true })
  const nonUniversalField = makeField({ id: 'f-custom', slug: 'custom', is_universal: false, name: 'Custom' })

  const baseInput: ResolveLayoutInput = {
    availableFields: [universalField, nonUniversalField],
    allSections: [section],
    userDefaultLayout: null,
    assetSelection: null
  }

  describe('system default (no template, no overrides)', () => {
    it('shows universal fields, hides non-universal', () => {
      const result = resolveLayout(baseInput)

      expect(result.templateSource).toBe('system-default')
      expect(result.activeTemplate).toBeNull()

      const uni = result.resolvedFields.find(f => f.field_id === 'f-uni')!
      const custom = result.resolvedFields.find(f => f.field_id === 'f-custom')!

      expect(uni.is_visible).toBe(true)
      expect(custom.is_visible).toBe(false)
    })

    it('tags decisions as system-default', () => {
      const result = resolveLayout(baseInput)
      const decisions = result.decisions

      expect(decisions.every(d => d.source === 'system-default')).toBe(true)
    })
  })

  describe('user default template', () => {
    it('uses user default when no asset selection', () => {
      const template = makeTemplate({
        id: 'user-default',
        is_default: true,
        field_config: [
          { field_id: 'f-uni', section_id: section.id, is_visible: true, display_order: 0, is_collapsed: false },
          { field_id: 'f-custom', section_id: section.id, is_visible: true, display_order: 1, is_collapsed: false }
        ]
      })

      const result = resolveLayout({
        ...baseInput,
        userDefaultLayout: template
      })

      expect(result.templateSource).toBe('user-default')
      expect(result.activeTemplate?.id).toBe('user-default')

      // Both fields should be visible per template config
      const uni = result.resolvedFields.find(f => f.field_id === 'f-uni')!
      const custom = result.resolvedFields.find(f => f.field_id === 'f-custom')!
      expect(uni.is_visible).toBe(true)
      expect(custom.is_visible).toBe(true)
    })

    it('hides fields not in the template', () => {
      const template = makeTemplate({
        id: 'user-default',
        is_default: true,
        field_config: [
          { field_id: 'f-uni', section_id: section.id, is_visible: true, display_order: 0, is_collapsed: false }
          // f-custom NOT in template
        ]
      })

      const result = resolveLayout({
        ...baseInput,
        userDefaultLayout: template
      })

      const custom = result.resolvedFields.find(f => f.field_id === 'f-custom')!
      expect(custom.is_visible).toBe(false)

      const decision = result.decisions.find(d => d.field_id === 'f-custom')!
      expect(decision.source).toBe('template-not-listed')
    })
  })

  describe('asset-level template selection', () => {
    it('uses asset-selected template over user default', () => {
      const userDefault = makeTemplate({
        id: 'user-default',
        name: 'User Default',
        is_default: true,
        field_config: [
          { field_id: 'f-uni', section_id: section.id, is_visible: true, display_order: 0, is_collapsed: false }
        ]
      })

      const assetTemplate = makeTemplate({
        id: 'asset-template',
        name: 'Asset Template',
        field_config: [
          { field_id: 'f-custom', section_id: section.id, is_visible: true, display_order: 0, is_collapsed: false }
        ]
      })

      const result = resolveLayout({
        ...baseInput,
        userDefaultLayout: userDefault,
        assetSelection: {
          layout_id: assetTemplate.id,
          layout: assetTemplate,
          field_overrides: null,
          section_overrides: null
        }
      })

      expect(result.templateSource).toBe('asset-selection')
      expect(result.activeTemplate?.id).toBe('asset-template')

      // f-custom visible (in asset template), f-uni hidden (not in asset template)
      const custom = result.resolvedFields.find(f => f.field_id === 'f-custom')!
      const uni = result.resolvedFields.find(f => f.field_id === 'f-uni')!
      expect(custom.is_visible).toBe(true)
      expect(uni.is_visible).toBe(false)
    })
  })

  describe('asset-level field overrides', () => {
    it('overrides template visibility', () => {
      const template = makeTemplate({
        id: 'tmpl',
        field_config: [
          { field_id: 'f-uni', section_id: section.id, is_visible: true, display_order: 0, is_collapsed: false },
          { field_id: 'f-custom', section_id: section.id, is_visible: false, display_order: 1, is_collapsed: false }
        ]
      })

      const result = resolveLayout({
        ...baseInput,
        userDefaultLayout: null,
        assetSelection: {
          layout_id: template.id,
          layout: template,
          field_overrides: [
            { field_id: 'f-uni', is_visible: false },   // override: hide
            { field_id: 'f-custom', is_visible: true }   // override: show
          ],
          section_overrides: null
        }
      })

      const uni = result.resolvedFields.find(f => f.field_id === 'f-uni')!
      const custom = result.resolvedFields.find(f => f.field_id === 'f-custom')!

      expect(uni.is_visible).toBe(false)
      expect(custom.is_visible).toBe(true)

      // Verify sources
      const uniDecision = result.decisions.find(d => d.field_id === 'f-uni')!
      expect(uniDecision.source).toBe('asset-override')
    })
  })

  describe('overrides without template (only overrides)', () => {
    it('applies overrides on top of user default', () => {
      const userDefault = makeTemplate({
        id: 'user-default',
        is_default: true,
        field_config: [
          { field_id: 'f-uni', section_id: section.id, is_visible: true, display_order: 0, is_collapsed: false }
        ]
      })

      const result = resolveLayout({
        ...baseInput,
        userDefaultLayout: userDefault,
        assetSelection: {
          layout_id: null,
          layout: null,
          field_overrides: [
            { field_id: 'f-custom', is_visible: true } // add field not in template
          ],
          section_overrides: null
        }
      })

      // Should use user default as base
      expect(result.templateSource).toBe('user-default')

      // f-uni visible from template, f-custom visible from override
      const uni = result.resolvedFields.find(f => f.field_id === 'f-uni')!
      const custom = result.resolvedFields.find(f => f.field_id === 'f-custom')!
      expect(uni.is_visible).toBe(true)
      expect(custom.is_visible).toBe(true)
    })
  })

  describe('section overrides', () => {
    it('applies section name override', () => {
      const result = resolveLayout({
        ...baseInput,
        assetSelection: {
          layout_id: null,
          layout: null,
          field_overrides: null,
          section_overrides: [
            { section_id: section.id, name_override: 'Renamed Thesis' }
          ]
        }
      })

      const uni = result.resolvedFields.find(f => f.field_id === 'f-uni')!
      expect(uni.section_name).toBe('Renamed Thesis')
    })
  })

  describe('hasAssetCustomization', () => {
    it('is false when no asset selection', () => {
      const result = resolveLayout(baseInput)
      expect(result.hasAssetCustomization).toBe(false)
    })

    it('is true when overrides exist', () => {
      const result = resolveLayout({
        ...baseInput,
        assetSelection: {
          layout_id: null,
          layout: null,
          field_overrides: [{ field_id: 'f-uni', is_visible: false }],
          section_overrides: null
        }
      })
      expect(result.hasAssetCustomization).toBe(true)
    })
  })
})

// ============================================================================
// toCanonicalPresetId
// ============================================================================

describe('toCanonicalPresetId', () => {
  it('is the same function as normalizePresetFieldId', () => {
    expect(toCanonicalPresetId).toBe(normalizePresetFieldId)
  })

  it('strips timestamp from preset IDs', () => {
    expect(toCanonicalPresetId('preset-competitive_landscape-1768168549905'))
      .toBe('preset-competitive_landscape')
  })

  it('leaves canonical preset IDs unchanged', () => {
    expect(toCanonicalPresetId('preset-competitive_landscape'))
      .toBe('preset-competitive_landscape')
  })

  it('leaves UUIDs unchanged', () => {
    expect(toCanonicalPresetId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
      .toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })

  it('handles multi-hyphen preset slugs', () => {
    // "preset-ev-to-ebitda-1768168549905" — slug is "ev-to-ebitda"
    expect(toCanonicalPresetId('preset-ev-to-ebitda-1768168549905'))
      .toBe('preset-ev-to-ebitda')
  })

  it('handles multi-hyphen preset slugs without timestamp', () => {
    expect(toCanonicalPresetId('preset-ev-to-ebitda'))
      .toBe('preset-ev-to-ebitda')
  })

  it('does not strip non-numeric trailing segments', () => {
    expect(toCanonicalPresetId('preset-supply-chain-risk'))
      .toBe('preset-supply-chain-risk')
  })
})
