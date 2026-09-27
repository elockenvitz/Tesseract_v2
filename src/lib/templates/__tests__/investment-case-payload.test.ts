/**
 * Investment Case PDF: the phone writes what the desktop writes. Nothing more.
 *
 * The product decision for this template type was parity, explicitly: mobile
 * adds no new behaviour, and the two columns the desktop omits stay omitted.
 * This file is the regression test for that decision — the one asked for by
 * name, proving a mobile save does not begin writing columns desktop omits.
 *
 * The desktop's payload is not a guess. `handleSave` in
 * InvestmentCaseTemplateEditor.tsx sends the same eight keys for create and
 * for update, and neither carries `section_config` or `is_default`.
 */
import { describe, it, expect } from 'vitest'
import {
  buildSavePayload,
  validateDraft,
  SAVE_PAYLOAD_KEYS,
  OMITTED_KEYS,
  type InvestmentCaseDraft,
} from '../investment-case-payload'
import {
  DEFAULT_BRANDING_CONFIG,
  DEFAULT_COVER_CONFIG,
  DEFAULT_HEADER_FOOTER_CONFIG,
  DEFAULT_STYLE_CONFIG,
  DEFAULT_TOC_CONFIG,
} from '../../../types/investmentCaseTemplates'

const DRAFT: InvestmentCaseDraft = {
  name: 'Quarterly case',
  description: 'For the IC pack',
  isShared: false,
  coverConfig: DEFAULT_COVER_CONFIG,
  styleConfig: DEFAULT_STYLE_CONFIG,
  brandingConfig: DEFAULT_BRANDING_CONFIG,
  headerFooterConfig: DEFAULT_HEADER_FOOTER_CONFIG,
  tocConfig: DEFAULT_TOC_CONFIG,
}

describe('the payload carries exactly the desktop key set', () => {
  it('emits the eight keys the desktop emits', () => {
    expect(Object.keys(buildSavePayload(DRAFT)).sort()).toEqual([...SAVE_PAYLOAD_KEYS].sort())
  })

  it('omits section_config and is_default', () => {
    // The named regression. `section_config` is computed by the desktop but
    // never persisted; `is_default` belongs to the separate setDefault
    // mutation. A phone writing either would be the only client doing so.
    const payload = buildSavePayload(DRAFT) as unknown as Record<string, unknown>
    for (const key of OMITTED_KEYS) {
      expect(payload).not.toHaveProperty(key)
    }
  })

  it('keeps the two lists disjoint, so neither can drift into the other', () => {
    for (const omitted of OMITTED_KEYS) {
      expect(SAVE_PAYLOAD_KEYS as readonly string[]).not.toContain(omitted)
    }
  })

  it('carries every config object through by reference, unmodified', () => {
    const payload = buildSavePayload(DRAFT)
    expect(payload.cover_config).toBe(DRAFT.coverConfig)
    expect(payload.style_config).toBe(DRAFT.styleConfig)
    expect(payload.branding_config).toBe(DRAFT.brandingConfig)
    expect(payload.header_footer_config).toBe(DRAFT.headerFooterConfig)
    expect(payload.toc_config).toBe(DRAFT.tocConfig)
  })

  it('is the same shape whether the save creates or updates', () => {
    // The desktop uses one payload shape for both; a phone that diverged
    // would make create and update disagree about the row.
    const a = buildSavePayload(DRAFT)
    const b = buildSavePayload({ ...DRAFT, name: 'Renamed' })
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
  })
})

describe('field normalisation matches the desktop', () => {
  it('turns an empty description into null, not an empty string', () => {
    // The desktop sends `description || null`. Sending '' instead would make
    // the two clients write different rows for the same empty box.
    expect(buildSavePayload({ ...DRAFT, description: '' }).description).toBeNull()
    expect(buildSavePayload({ ...DRAFT, description: '   ' }).description).toBeNull()
  })

  it('keeps a real description', () => {
    expect(buildSavePayload(DRAFT).description).toBe('For the IC pack')
  })

  it('trims the name', () => {
    expect(buildSavePayload({ ...DRAFT, name: '  Spaced  ' }).name).toBe('Spaced')
  })

  it('passes is_shared straight through', () => {
    expect(buildSavePayload({ ...DRAFT, isShared: true }).is_shared).toBe(true)
    expect(buildSavePayload(DRAFT).is_shared).toBe(false)
  })
})

describe('validateDraft', () => {
  it('requires a name, as the desktop does', () => {
    expect(validateDraft({ ...DRAFT, name: '' })).toMatch(/name is required/i)
    expect(validateDraft({ ...DRAFT, name: '   ' })).toMatch(/name is required/i)
  })

  it('accepts a named draft with everything else defaulted', () => {
    expect(validateDraft(DRAFT)).toBeNull()
    // No content requirement: a template is configuration, and every config
    // already has a default. Inventing a second rule would make the phone
    // refuse a template the desktop accepts.
    expect(validateDraft({ ...DRAFT, description: '' })).toBeNull()
  })
})
