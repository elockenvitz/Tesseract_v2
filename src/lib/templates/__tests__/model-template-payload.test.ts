/**
 * Excel Extraction: what a phone hands the existing mutations.
 *
 * The sharpest thing pinned here is a correction. The brief for this lane
 * said to preserve `dynamic_mappings = null`. The desktop does not write
 * null: its form seeds `[]`, always passes it, and the hook's
 * `dynamicMappings || null` never reaches the null branch because `[]` is
 * truthy. Writing null "for parity" would make the phone the only client
 * producing null rows — so the test asserts `[]`, and says why.
 */
import { describe, it, expect } from 'vitest'
import {
  buildSavePayload,
  emptyDraft,
  validateDraft,
  SAVE_PAYLOAD_KEYS,
  HOOK_OWNED_KEYS,
  type ModelTemplateDraft,
} from '../model-template-payload'
import type { FieldMapping } from '../../../hooks/useModelTemplates'

const MAPPING: FieldMapping = {
  field: 'price_target',
  cell: 'Summary!B5',
  type: 'currency',
  label: 'Price Target',
}

const DRAFT: ModelTemplateDraft = {
  ...emptyDraft(),
  name: 'One-pager',
  description: 'Standard model',
  fieldMappings: [MAPPING],
}

describe('the payload matches the desktop mutation arguments', () => {
  it('passes exactly the six the desktop passes', () => {
    expect(Object.keys(buildSavePayload(DRAFT)).sort()).toEqual([...SAVE_PAYLOAD_KEYS].sort())
  })

  it('never supplies a key the hook owns', () => {
    // created_by is what RLS checks; organization_id and is_firm_template
    // decide who can read the row. A save must not set any of them.
    const payload = buildSavePayload(DRAFT) as unknown as Record<string, unknown>
    for (const key of HOOK_OWNED_KEYS) {
      expect(payload).not.toHaveProperty(key)
    }
    expect(payload).not.toHaveProperty('created_by')
    expect(payload).not.toHaveProperty('organization_id')
    expect(payload).not.toHaveProperty('is_firm_template')
  })

  it('sends an empty description as undefined, as the desktop does', () => {
    // Desktop: `description || undefined`, then the hook stores
    // `description || null`. Matching the undefined lands both clients on
    // the same null in the column.
    expect(buildSavePayload({ ...DRAFT, description: '' }).description).toBeUndefined()
    expect(buildSavePayload({ ...DRAFT, description: '  ' }).description).toBeUndefined()
    expect(buildSavePayload(DRAFT).description).toBe('Standard model')
  })

  it('trims the name', () => {
    expect(buildSavePayload({ ...DRAFT, name: '  One-pager ' }).name).toBe('One-pager')
  })

  it('passes the mappings through by reference, unmodified', () => {
    expect(buildSavePayload(DRAFT).fieldMappings).toBe(DRAFT.fieldMappings)
  })
})

describe('the empty draft matches what the desktop form seeds', () => {
  it('starts dynamicMappings as [] and NOT null', () => {
    // The correction. `[] || null` is `[]`, so the desktop's stored value is
    // an empty array; a phone writing null would diverge on every new row.
    expect(emptyDraft().dynamicMappings).toEqual([])
    expect(emptyDraft().dynamicMappings).not.toBeNull()
  })

  it('starts snapshotRanges as [] and detectionRules as {}', () => {
    expect(emptyDraft().snapshotRanges).toEqual([])
    expect(emptyDraft().detectionRules).toEqual({})
  })

  it('carries those defaults into the payload untouched', () => {
    const payload = buildSavePayload({ ...emptyDraft(), name: 'X' })
    expect(payload.dynamicMappings).toEqual([])
    expect(payload.snapshotRanges).toEqual([])
    expect(payload.detectionRules).toEqual({})
  })
})

describe('validation keeps the desktop rules and adds the one a phone needs', () => {
  it('requires a name', () => {
    expect(validateDraft({ ...DRAFT, name: '' })).toMatch(/name is required/i)
  })

  it('requires at least one mapping, as the desktop does', () => {
    expect(validateDraft({ ...DRAFT, fieldMappings: [] })).toMatch(/at least one field mapping/i)
  })

  it('requires both a cell and a field on every mapping, as the desktop does', () => {
    expect(
      validateDraft({ ...DRAFT, fieldMappings: [{ ...MAPPING, cell: '' }] }),
    ).toMatch(/both a cell reference and a tesseract field/i)
    expect(
      validateDraft({ ...DRAFT, fieldMappings: [{ ...MAPPING, field: '' }] }),
    ).toMatch(/both a cell reference and a tesseract field/i)
  })

  it('rejects a malformed cell reference, which the desktop cannot produce', () => {
    // The desktop needs no such rule: a cell can only arrive by clicking a
    // grid. A phone accepts typing, so the guarantee has to come from here
    // rather than from extraction time against a real workbook.
    const bad = validateDraft({ ...DRAFT, fieldMappings: [{ ...MAPPING, cell: 'B' }] })
    expect(bad).toMatch(/not a cell reference/i)
    // The message names the offending value and shows both valid shapes.
    expect(bad).toContain('"B"')
    expect(bad).toContain('Summary!B12')
  })

  it('accepts both a bare and a sheet-qualified cell', () => {
    expect(validateDraft({ ...DRAFT, fieldMappings: [{ ...MAPPING, cell: 'B5' }] })).toBeNull()
    expect(validateDraft({ ...DRAFT, fieldMappings: [{ ...MAPPING, cell: 'Summary!B5' }] })).toBeNull()
  })

  it('rejects a malformed snapshot range but ignores an empty one', () => {
    expect(
      validateDraft({ ...DRAFT, snapshotRanges: [{ name: 'Model', range: 'A1' }] }),
    ).toMatch(/not a range/i)
    // An empty row is an unfinished row, not an error — the desktop's own
    // addRange seeds `{name: '', range: ''}`.
    expect(validateDraft({ ...DRAFT, snapshotRanges: [{ name: '', range: '' }] })).toBeNull()
  })

  it('requires a name on a range that has a reference', () => {
    expect(
      validateDraft({ ...DRAFT, snapshotRanges: [{ name: '', range: 'A1:H30' }] }),
    ).toMatch(/needs a name/i)
  })

  it('accepts a complete draft', () => {
    expect(validateDraft(DRAFT)).toBeNull()
  })
})
