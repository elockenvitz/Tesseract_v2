import { describe, it, expect } from 'vitest'
import {
  resolveLayout,
  normalizePresetFieldId,
  extractPresetSlug,
  fieldConfigMatchesField,
  overrideDiffersFromBaseline,
  reorderedSectionOverrides,
  catalogFieldOrder,
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

describe('overrideDiffersFromBaseline', () => {
  /*
   * Two callers depend on this and must not drift apart: the save, which
   * drops no-op overrides so that setting a page back by hand genuinely
   * returns it to the template, and the status chip, which decides
   * whether to label the page "Custom layout".
   *
   * Both directions of an error are bad and neither is visible. Too
   * eager and a real setting is pruned away as tidying — the reader's
   * layout silently deleted. Too cautious and the stock stays PINNED to
   * an override that merely agrees with today's template, so a later
   * template change skips it with nothing to explain why.
   */
  const base = { span: 6, is_visible: true, section_id: 'sec-1', display_order: 2 }

  it('keeps an override for a field the template says nothing about', () => {
    expect(overrideDiffersFromBaseline({ field_id: 'f1', is_visible: true }, undefined)).toBe(true)
  })

  it('drops an override that repeats the template exactly', () => {
    expect(
      overrideDiffersFromBaseline(
        { field_id: 'f1', is_visible: true, span: 6, section_id: 'sec-1', display_order: 2 },
        base,
      ),
    ).toBe(false)
  })

  it('drops an override that states nothing but visibility it already had', () => {
    expect(overrideDiffersFromBaseline({ field_id: 'f1', is_visible: true }, base)).toBe(false)
  })

  it.each([
    ['a different span', { span: 4 }],
    ['being hidden', { is_visible: false }],
    ['a different section', { section_id: 'sec-2' }],
    ['a different position', { display_order: 5 }],
  ])('keeps an override that states %s', (_label, patch) => {
    expect(
      overrideDiffersFromBaseline({ field_id: 'f1', is_visible: true, ...patch }, base),
    ).toBe(true)
  })

  it('reads a legacy width as the span it means', () => {
    /* The dangerous case. An override written before spans existed says
       `width: 'half'` and no span at all. Comparing only `span` reads it
       as saying nothing, prunes it, and silently widens a field the
       reader narrowed years ago — a data loss with no error. */
    expect(overrideDiffersFromBaseline({ field_id: 'f1', is_visible: true, width: 'half' }, base))
      .toBe(false)
    expect(
      overrideDiffersFromBaseline(
        { field_id: 'f1', is_visible: true, width: 'half' },
        { ...base, span: 12 },
      ),
    ).toBe(true)
    expect(
      overrideDiffersFromBaseline(
        { field_id: 'f1', is_visible: true, width: 'full' },
        { ...base, span: 12 },
      ),
    ).toBe(false)
  })

  it('lets a span win over a legacy width on the same override', () => {
    /* The resolver prefers span over width when both are present, so
       this must agree with it or the two would disagree about whether a
       page is customized. */
    expect(
      overrideDiffersFromBaseline(
        { field_id: 'f1', is_visible: true, span: 6, width: 'full' },
        base,
      ),
    ).toBe(false)
  })

  it('treats a template that never stated a span as the full row', () => {
    /* A field the template does not size draws full width, so an
       override saying 12 is agreeing with it, not overriding it. */
    expect(
      overrideDiffersFromBaseline(
        { field_id: 'f1', is_visible: true, span: 12 },
        { is_visible: true },
      ),
    ).toBe(false)
    expect(
      overrideDiffersFromBaseline({ field_id: 'f1', is_visible: true, span: 6 }, { is_visible: true }),
    ).toBe(true)
  })

  it('ignores an unusable span rather than treating it as a difference', () => {
    /* `field_overrides` is jsonb written by several versions of this
       app. A 0 or a 7.5 cannot be drawn and the resolver rejects it in
       favour of the next source, so it is not a real instruction here
       either. */
    expect(
      overrideDiffersFromBaseline({ field_id: 'f1', is_visible: true, span: 0 }, base),
    ).toBe(false)
    expect(
      overrideDiffersFromBaseline({ field_id: 'f1', is_visible: true, span: 99 }, base),
    ).toBe(false)
  })
})

describe('catalogFieldOrder', () => {
  /*
   * The defect: the catalogue query sorted on `research_fields.display_order`
   * alone, which is only meaningful within a section. In the live database the
   * first field of all three default sections carries 0, so three rows tied
   * and Postgres picked. Arrival order then decided the Default template's
   * section order, which is how it disagreed with the asset page.
   *
   * These rows are the real eight, with the real numbers.
   */
  const SECTION = { thesis: 0, catalysts: 1, forecasts: 2 }
  const CATALOG = [
    { name: 'Business Model', section_display_order: SECTION.thesis, display_order: 0 },
    { name: 'Thesis', section_display_order: SECTION.thesis, display_order: 1 },
    { name: 'Where Different', section_display_order: SECTION.thesis, display_order: 2 },
    { name: 'Risks to Thesis', section_display_order: SECTION.thesis, display_order: 3 },
    { name: 'Key Catalysts', section_display_order: SECTION.catalysts, display_order: 0 },
    { name: 'Rating', section_display_order: SECTION.forecasts, display_order: 0 },
    { name: 'Price Targets', section_display_order: SECTION.forecasts, display_order: 1 },
    { name: 'Estimates', section_display_order: SECTION.forecasts, display_order: 2 },
  ]

  const sorted = (rows: typeof CATALOG) => [...rows].sort(catalogFieldOrder).map(r => r.name)

  it('groups by section before ordering within it', () => {
    expect(sorted(CATALOG)).toEqual([
      'Business Model', 'Thesis', 'Where Different', 'Risks to Thesis',
      'Key Catalysts',
      'Rating', 'Price Targets', 'Estimates',
    ])
  })

  it('gives the same answer whatever order the rows arrive in', () => {
    // The three display_order-0 rows are the tie that Postgres used to break.
    const want = sorted(CATALOG)
    expect(sorted([...CATALOG].reverse())).toEqual(want)
    expect(sorted([...CATALOG].sort((a, b) => a.name.localeCompare(b.name)))).toEqual(want)
    expect(sorted([...CATALOG].sort((a, b) => b.name.localeCompare(a.name)))).toEqual(want)
  })

  it('does not let a low field number jump a section boundary', () => {
    // Rating is 0 in Forecasts; Risks to Thesis is 3 in Thesis. Section wins.
    expect(catalogFieldOrder(
      { section_display_order: 2, display_order: 0, name: 'Rating' },
      { section_display_order: 0, display_order: 3, name: 'Risks to Thesis' },
    )).toBeGreaterThan(0)
  })

  it('breaks a total tie by name instead of leaving it to the database', () => {
    expect(catalogFieldOrder(
      { section_display_order: 0, display_order: 0, name: 'Alpha' },
      { section_display_order: 0, display_order: 0, name: 'Beta' },
    )).toBeLessThan(0)
    // And is a real total order: never 0 for two differently-named rows.
    expect(catalogFieldOrder(
      { section_display_order: 0, display_order: 0, name: 'Beta' },
      { section_display_order: 0, display_order: 0, name: 'Alpha' },
    )).toBeGreaterThan(0)
  })

  it('treats a missing number as 0, the column’s own default', () => {
    expect(catalogFieldOrder(
      { display_order: null, name: 'A' },
      { section_display_order: 0, display_order: 0, name: 'A' },
    )).toBe(0)
    expect(catalogFieldOrder(
      { section_display_order: null, display_order: 5, name: 'A' },
      { section_display_order: 1, display_order: 0, name: 'A' },
    )).toBeLessThan(0)
  })

  it('is symmetric, so the sort is stable in either direction', () => {
    for (const a of CATALOG) {
      for (const b of CATALOG) {
        // Summed rather than negated: -Math.sign(0) is -0, and Object.is
        // equality treats that as different from 0.
        expect(Math.sign(catalogFieldOrder(a, b)) + Math.sign(catalogFieldOrder(b, a))).toBe(0)
      }
    }
  })
})

describe('reorderedSectionOverrides', () => {
  /*
   * `display_order` is absolute, so a reorder has to number every
   * section. Right while the order differs from the template's; wrong
   * once it does not, because then the stock carries explicit positions
   * that merely repeat the template and will silently refuse to follow
   * it when it changes.
   */
  const baseline: Record<string, number> = { a: 0, b: 1, c: 2 }
  const baselineOrderOf = (id: string) => baseline[id] ?? null

  it('numbers every section when the order really differs', () => {
    expect(
      reorderedSectionOverrides({
        orderedSectionIds: ['b', 'a', 'c'],
        currentOverrides: [],
        baselineOrderOf,
      }),
    ).toEqual([
      { section_id: 'b', display_order: 0 },
      { section_id: 'a', display_order: 1 },
      { section_id: 'c', display_order: 2 },
    ])
  })

  it('writes nothing at all when the order is already the template order', () => {
    /* The nudge-down-then-back-up case. This used to leave one explicit
       position per section behind, pinning the stock forever. */
    expect(
      reorderedSectionOverrides({
        orderedSectionIds: ['a', 'b', 'c'],
        currentOverrides: [
          { section_id: 'a', display_order: 0 },
          { section_id: 'b', display_order: 1 },
          { section_id: 'c', display_order: 2 },
        ],
        baselineOrderOf,
      }),
    ).toEqual([])
  })

  it('keeps what an override says apart from its position', () => {
    expect(
      reorderedSectionOverrides({
        orderedSectionIds: ['a', 'b', 'c'],
        currentOverrides: [
          { section_id: 'a', display_order: 0, name_override: 'Bull case' },
          { section_id: 'b', display_order: 1, is_hidden: true },
          { section_id: 'c', display_order: 2 },
        ],
        baselineOrderOf,
      }),
    ).toEqual([
      { section_id: 'a', name_override: 'Bull case' },
      { section_id: 'b', is_hidden: true },
    ])
  })

  it('drops an is_hidden:false the template does not need', () => {
    /* Against a template that does not hide the section it says nothing;
       against one that does, it is the only way to ask for it back. */
    const args = {
      orderedSectionIds: ['a', 'b', 'c'],
      currentOverrides: [{ section_id: 'b', display_order: 1, is_hidden: false }],
      baselineOrderOf,
    }
    expect(reorderedSectionOverrides(args)).toEqual([])
    expect(
      reorderedSectionOverrides({ ...args, templateHidesSection: id => id === 'b' }),
    ).toEqual([{ section_id: 'b', is_hidden: false }])
  })

  it('keeps explicit positions when a baseline position is unknown', () => {
    /* A section the template says nothing about and that carries no
       display_order of its own. "This is the baseline" cannot be
       established, so the reader's arrangement is written rather than
       guessed at. */
    expect(
      reorderedSectionOverrides({
        orderedSectionIds: ['a', 'b', 'unknown'],
        currentOverrides: [],
        baselineOrderOf,
      }),
    ).toEqual([
      { section_id: 'a', display_order: 0 },
      { section_id: 'b', display_order: 1 },
      { section_id: 'unknown', display_order: 2 },
    ])
  })

  it('keeps explicit positions when two sections share a baseline position', () => {
    /* They have no defined order between them, so the order on screen
       cannot be proven to be the baseline one. */
    const tied = (id: string) => ({ a: 0, b: 0, c: 2 }[id] ?? null)
    expect(
      reorderedSectionOverrides({
        orderedSectionIds: ['a', 'b', 'c'],
        currentOverrides: [],
        baselineOrderOf: tied,
      })
    ).toEqual([
      { section_id: 'a', display_order: 0 },
      { section_id: 'b', display_order: 1 },
      { section_id: 'c', display_order: 2 },
    ])
  })

  it('never drops an override for a section the reorder did not mention', () => {
    /* The stored array is replaced wholesale, and the ordered list only
       holds what the page is drawing — so rebuilding from it alone
       deleted the rename and hidden flag of anything off screen. */
    const offScreen = { section_id: 'z', name_override: 'Appendix', is_hidden: true }
    expect(
      reorderedSectionOverrides({
        orderedSectionIds: ['b', 'a'],
        currentOverrides: [offScreen],
        baselineOrderOf,
      }),
    ).toContainEqual(offScreen)
  })

  it('carries an off-screen override through a no-op reorder too', () => {
    const offScreen = { section_id: 'z', name_override: 'Appendix' }
    expect(
      reorderedSectionOverrides({
        orderedSectionIds: ['a', 'b', 'c'],
        currentOverrides: [{ section_id: 'a', display_order: 0 }, offScreen],
        baselineOrderOf,
      }),
    ).toEqual([offScreen])
  })
})

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
