import { describe, it, expect } from 'vitest'

/**
 * Tests for the save_asset_layout_customization RPC parameter building logic.
 * These test the client-side parameter construction that feeds the RPC,
 * not the RPC itself (which runs in Postgres).
 */

interface FieldOverride {
  field_id: string
  is_visible: boolean
  section_id?: string
  display_order?: number
}

interface SectionOverride {
  section_id: string
  name_override?: string
  is_hidden?: boolean
  display_order?: number
  is_added?: boolean
}

interface DraftFieldOverride {
  field_id: string
  is_visible: boolean
  section_id?: string
  display_order?: number
  _removeFromDatabase?: boolean
}

interface SaveCustomizationParams {
  layoutId?: string | null
  fieldOverrides: FieldOverride[]
  sectionOverrides: SectionOverride[]
  newSections: Array<{ temp_id: string; name: string }>
  clearAll?: boolean
}

/**
 * Build RPC params from draft state — extracted logic matching AssetPageFieldCustomizer.
 */
function buildSaveParams(
  draftFieldOverrides: Map<string, DraftFieldOverride>,
  draftSectionOverrides: Map<string, SectionOverride>,
  draftNewSections: Array<{ temp_id: string; name: string }>,
  draftLayoutId?: string | null
): SaveCustomizationParams {
  const hasNoOverrides = draftFieldOverrides.size === 0 &&
                         draftSectionOverrides.size === 0 &&
                         draftNewSections.length === 0
  const clearAll = hasNoOverrides && draftLayoutId === undefined

  const fieldOverrides: FieldOverride[] = []
  draftFieldOverrides.forEach((override, fieldId) => {
    if (override._removeFromDatabase) return
    fieldOverrides.push({
      field_id: fieldId,
      is_visible: override.is_visible,
      section_id: override.section_id,
      display_order: override.display_order
    })
  })

  const sectionOverrides: SectionOverride[] = []
  draftSectionOverrides.forEach((override, sectionId) => {
    sectionOverrides.push({
      section_id: sectionId,
      name_override: override.name_override,
      is_hidden: override.is_hidden,
      display_order: override.display_order,
      is_added: override.is_added
    })
  })

  const newSections = draftNewSections.map(s => ({
    temp_id: s.temp_id,
    name: s.name
  }))

  return { layoutId: draftLayoutId, fieldOverrides, sectionOverrides, newSections, clearAll }
}

describe('buildSaveParams', () => {
  it('builds correct params from draft overrides', () => {
    const fieldOverrides = new Map<string, DraftFieldOverride>([
      ['field-1', { field_id: 'field-1', is_visible: true, section_id: 'sec-1', display_order: 0 }],
      ['field-2', { field_id: 'field-2', is_visible: false }]
    ])
    const sectionOverrides = new Map<string, SectionOverride>([
      ['sec-1', { section_id: 'sec-1', display_order: 0 }]
    ])

    const result = buildSaveParams(fieldOverrides, sectionOverrides, [], 'layout-123')

    expect(result.layoutId).toBe('layout-123')
    expect(result.fieldOverrides).toHaveLength(2)
    expect(result.sectionOverrides).toHaveLength(1)
    expect(result.clearAll).toBe(false)
  })

  it('excludes fields marked for removal', () => {
    const fieldOverrides = new Map<string, DraftFieldOverride>([
      ['field-1', { field_id: 'field-1', is_visible: true }],
      ['field-2', { field_id: 'field-2', is_visible: false, _removeFromDatabase: true }]
    ])

    const result = buildSaveParams(fieldOverrides, new Map(), [])

    expect(result.fieldOverrides).toHaveLength(1)
    expect(result.fieldOverrides[0].field_id).toBe('field-1')
  })

  it('sets clearAll when no overrides and no layout change', () => {
    const result = buildSaveParams(new Map(), new Map(), [])

    expect(result.clearAll).toBe(true)
    expect(result.fieldOverrides).toHaveLength(0)
    expect(result.sectionOverrides).toHaveLength(0)
    expect(result.newSections).toHaveLength(0)
  })

  it('does not set clearAll when layout is explicitly set', () => {
    const result = buildSaveParams(new Map(), new Map(), [], null)

    expect(result.clearAll).toBe(false)
    expect(result.layoutId).toBeNull()
  })

  it('includes new sections with temp_id mapping', () => {
    const newSections = [
      { temp_id: 'temp-123', name: 'New Section' },
      { temp_id: 'temp-456', name: 'Another Section' }
    ]

    const result = buildSaveParams(new Map(), new Map(), newSections)

    expect(result.newSections).toHaveLength(2)
    expect(result.newSections[0]).toEqual({ temp_id: 'temp-123', name: 'New Section' })
    expect(result.newSections[1]).toEqual({ temp_id: 'temp-456', name: 'Another Section' })
    expect(result.clearAll).toBe(false) // new sections exist
  })

  it('includes temp section IDs in section overrides (RPC handles mapping)', () => {
    const sectionOverrides = new Map<string, SectionOverride>([
      ['temp-123', { section_id: 'temp-123', is_added: true, display_order: 5 }],
      ['sec-real', { section_id: 'sec-real', name_override: 'Renamed' }]
    ])

    const result = buildSaveParams(new Map(), sectionOverrides, [
      { temp_id: 'temp-123', name: 'New Section' }
    ])

    expect(result.sectionOverrides).toHaveLength(2)
    expect(result.sectionOverrides.find(s => s.section_id === 'temp-123')?.is_added).toBe(true)
    expect(result.newSections).toHaveLength(1)
  })
})
