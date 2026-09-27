/**
 * Research Layout on a phone: the default layout, and Layout → Sections → Fields.
 *
 * Two things are pinned here that a pure model test cannot reach.
 *
 * The default layout is not a row. It is derived from
 * SYSTEM_DEFAULT_FIELD_SLUGS at render time, so a surface only sees it if it
 * computes it — and this one did not, which is why a phone showed "No saved
 * layouts yet" while a desktop showed "Default" off the same query. The
 * derivation itself is tested in lib/research/__tests__/default-layout; what
 * is tested here is that the SCREEN shows it, and that saving it creates a
 * row rather than updating an id that does not exist.
 *
 * The interaction model is the other half: sections collapsed by default, no
 * section dropdown per row, words instead of an eye, and arrows only where a
 * field actually has a position.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MobileResearchLayoutEditor } from '../mobile/MobileResearchLayoutEditor'
import type { FieldConfigItem } from '../../../lib/research/layout-resolver'

const saveLayout = { mutateAsync: vi.fn().mockResolvedValue({ id: 'new' }) }
const updateLayout = { mutateAsync: vi.fn().mockResolvedValue(undefined) }

interface TestLayout {
  id: string
  name: string
  description: string | null
  is_default: boolean
  user_id: string
  created_at: string
  updated_at: string
  is_shared_with_me: boolean
  my_permission: 'owner' | 'admin' | 'edit' | 'view'
  field_config: FieldConfigItem[]
}

const CUSTOM: TestLayout = {
  id: 'lay-1',
  name: 'Deep dive',
  description: null,
  is_default: false,
  user_id: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_shared_with_me: false,
  my_permission: 'owner',
  field_config: [
    { field_id: 'f-risks', section_id: 'sec-thesis', is_visible: true, display_order: 0, is_collapsed: false },
    { field_id: 'f-thesis', section_id: 'sec-thesis', is_visible: true, display_order: 1, is_collapsed: false },
    { field_id: 'f-rating', section_id: 'sec-forecast', is_visible: true, display_order: 0, is_collapsed: false },
  ],
}

let layouts: TestLayout[] = []
let isOrgAdmin = false

vi.mock('../../../hooks/useUserAssetPagePreferences', () => ({
  useUserAssetPageLayouts: () => ({ layouts, isLoading: false, saveLayout, updateLayout }),
}))

// `thesis`, `risks_to_thesis` and `rating` are curated default slugs;
// `my_custom_field` is not. That difference is what the default filters on.
vi.mock('../../../hooks/useResearchFields', () => ({
  useResearchSections: () => ({
    sections: [
      { id: 'sec-thesis', name: 'Thesis & Risks', display_order: 0 },
      { id: 'sec-forecast', name: 'Forecasts', display_order: 1 },
    ],
    isLoading: false,
  }),
  useResearchFields: () => ({
    fields: [
      { id: 'f-thesis', name: 'Thesis', slug: 'thesis', field_type: 'rich_text', section_id: 'sec-thesis' },
      { id: 'f-risks', name: 'Risks', slug: 'risks_to_thesis', field_type: 'rich_text', section_id: 'sec-thesis' },
      { id: 'f-model', name: 'Business Model', slug: 'my_custom_field', field_type: 'rich_text', section_id: 'sec-thesis' },
      { id: 'f-rating', name: 'Rating', slug: 'rating', field_type: 'rating', section_id: 'sec-forecast' },
    ],
    isLoading: false,
  }),
}))
vi.mock('../../../hooks/useIsOrgAdmin', () => ({
  useIsOrgAdmin: () => ({ isOrgAdmin, isLoading: false, canAuthorCatalog: isOrgAdmin }),
}))

beforeEach(() => {
  layouts = []
  isOrgAdmin = false
  saveLayout.mutateAsync.mockClear()
  updateLayout.mutateAsync.mockClear()
})
afterEach(() => vi.clearAllMocks())

/**
 * Open a layout from the list by its row.
 *
 * Matched on the row BUTTON rather than the text, because "Default" is both
 * the derived layout's name and the badge on whichever layout is canonically
 * default — `getByText('Default')` finds two nodes and says so.
 */
const openLayout = async (rowName: RegExp) => {
  render(<MobileResearchLayoutEditor onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: rowName }))
}

/** The derived default's row — uniquely identified by its System badge. */
const SYSTEM_ROW = /System/
/** A custom layout's row. */
const customRow = (name: string) => new RegExp(name)

/** Expand a collapsed section by its header. */
const expandSection = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('button', { expanded: false, name }))

// ============================================================================

describe('the canonical default layout is visible on a phone', () => {
  it('appears when the user has no layouts at all', async () => {
    // The reported defect: this screen said "No saved layouts yet".
    render(<MobileResearchLayoutEditor onBack={vi.fn()} />)
    expect(await screen.findByRole('button', { name: SYSTEM_ROW })).toBeInTheDocument()
  })

  it('is labelled Default and System, and counts only the curated fields', async () => {
    render(<MobileResearchLayoutEditor onBack={vi.fn()} />)
    const row = await screen.findByRole('button', { name: SYSTEM_ROW })

    // Two nodes legitimately read "Default" in this row: the layout's name
    // and the badge marking it canonically default. Both are wanted.
    expect(within(row).getAllByText('Default')).toHaveLength(2)
    expect(within(row).getByText('System')).toBeInTheDocument()
    // thesis + risks_to_thesis + rating are curated; my_custom_field is not.
    expect(within(row).getByText(/3 of 3 fields/)).toBeInTheDocument()
  })

  it('still appears alongside a custom layout that is not the default', async () => {
    layouts = [CUSTOM]
    render(<MobileResearchLayoutEditor onBack={vi.fn()} />)

    expect(await screen.findByRole('button', { name: SYSTEM_ROW })).toBeInTheDocument()
    expect(screen.getByText('Deep dive')).toBeInTheDocument()
  })

  it('is withdrawn once the user has a default of their own', async () => {
    // Two things called Default is worse than either alone.
    layouts = [{ ...CUSTOM, is_default: true }]
    render(<MobileResearchLayoutEditor onBack={vi.fn()} />)

    await screen.findByText('Deep dive')
    expect(screen.queryByText('System')).not.toBeInTheDocument()
  })

  it('is NOT withdrawn by somebody else’s shared default', async () => {
    layouts = [{ ...CUSTOM, is_default: true, is_shared_with_me: true, my_permission: 'view' }]
    render(<MobileResearchLayoutEditor onBack={vi.fn()} />)

    expect(await screen.findByRole('button', { name: SYSTEM_ROW })).toBeInTheDocument()
  })
})

describe('saving the default creates the user’s own layout', () => {
  it('explains that once, before any tap', async () => {
    await openLayout(SYSTEM_ROW)
    expect(await screen.findByText(/Saving creates your own copy/i)).toBeInTheDocument()
  })

  it('opens under its own name, not a second "Default"', async () => {
    await openLayout(SYSTEM_ROW)
    expect(await screen.findByLabelText(/template name/i)).toHaveValue('My layout')
  })

  it('calls saveLayout, never updateLayout with the sentinel id', async () => {
    // `system-default` is not a row. An update would target nothing.
    await openLayout(SYSTEM_ROW)
    fireEvent.click(await screen.findByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(saveLayout.mutateAsync).toHaveBeenCalled())
    expect(updateLayout.mutateAsync).not.toHaveBeenCalled()

    const arg = saveLayout.mutateAsync.mock.calls[0][0]
    expect(arg.name).toBe('My layout')
    // isDefault is deliberately absent: mobile reads is_default, never writes it.
    expect(Object.keys(arg).sort()).toEqual(['fieldConfig', 'name'])
  })

  it('carries the derived field_config into the new row', async () => {
    await openLayout(SYSTEM_ROW)
    fireEvent.click(await screen.findByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(saveLayout.mutateAsync).toHaveBeenCalled())
    const cfg = saveLayout.mutateAsync.mock.calls[0][0].fieldConfig as FieldConfigItem[]
    expect(cfg.map((i) => i.field_id).sort()).toEqual(['f-rating', 'f-risks', 'f-thesis'])
  })
})

describe('Layout → Sections → Fields', () => {
  beforeEach(() => { layouts = [CUSTOM] })

  it('opens with every section collapsed, so the layout fits one screen', async () => {
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')

    // Collapsed: the header is there, the field rows are not.
    expect(screen.queryByText('Risks')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { expanded: false, name: /Thesis & Risks/ }))
      .toBeInTheDocument()
  })

  it('summarises each section as "X shown · Y fields"', async () => {
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')

    // sec-thesis: risks + thesis shown, business model readable but unlisted.
    expect(screen.getByText('2 shown · 3 fields')).toBeInTheDocument()
    // Singular where it should be: Forecasts holds one field.
    expect(screen.getByText('1 shown · 1 field')).toBeInTheDocument()
  })

  it('reveals its fields when expanded', async () => {
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')
    expandSection(/Thesis & Risks/)

    expect(screen.getByText('Risks')).toBeInTheDocument()
    expect(screen.getByText('Thesis')).toBeInTheDocument()
  })

  it('says Shown / Hidden in words rather than relying on an eye', async () => {
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')
    expandSection(/Thesis & Risks/)

    expect(screen.getAllByText('Shown').length).toBeGreaterThan(0)
    expect(screen.getByText('Hidden')).toBeInTheDocument()
  })

  it('shows no per-row section dropdown', async () => {
    // It used to be a <select> on all 29 rows: the rarest action, given the
    // most prominent control and 7rem of every row's width.
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')
    expandSection(/Thesis & Risks/)

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Section for /)).not.toBeInTheDocument()
  })

  it('gives reorder arrows only to shown fields', async () => {
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')
    expandSection(/Thesis & Risks/)

    expect(screen.getByLabelText('Move Risks down')).toBeInTheDocument()
    // Business Model is hidden: it has no position, so no arrows at all.
    expect(screen.queryByLabelText('Move Business Model up')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Move Business Model down')).not.toBeInTheDocument()
  })
})

describe('edits reach the canonical config', () => {
  beforeEach(() => { layouts = [CUSTOM] })

  const save = () => fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

  it('persists a reorder within a section', async () => {
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')
    expandSection(/Thesis & Risks/)
    fireEvent.click(screen.getByLabelText('Move Risks down'))
    save()

    await waitFor(() => expect(updateLayout.mutateAsync).toHaveBeenCalled())
    const cfg = updateLayout.mutateAsync.mock.calls[0][0].fieldConfig as FieldConfigItem[]
    const thesis = cfg.filter((i) => i.section_id === 'sec-thesis')
    expect(thesis.map((i) => i.field_id)).toEqual(['f-thesis', 'f-risks'])
    expect(thesis.map((i) => i.display_order)).toEqual([0, 1])
  })

  it('persists a visibility change', async () => {
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')
    expandSection(/Thesis & Risks/)
    fireEvent.click(screen.getByLabelText('Show Business Model'))
    save()

    await waitFor(() => expect(updateLayout.mutateAsync).toHaveBeenCalled())
    const cfg = updateLayout.mutateAsync.mock.calls[0][0].fieldConfig as FieldConfigItem[]
    expect(cfg.find((i) => i.field_id === 'f-model')?.is_visible).toBe(true)
  })

  it('moves a field to another section through the sheet, not a dropdown', async () => {
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')
    expandSection(/Thesis & Risks/)

    fireEvent.click(screen.getByLabelText('More actions for Risks'))
    const sheet = await screen.findByText('Move to section')
    fireEvent.click(within(sheet.closest('div')!.parentElement!).getByText('Forecasts'))
    save()

    await waitFor(() => expect(updateLayout.mutateAsync).toHaveBeenCalled())
    const cfg = updateLayout.mutateAsync.mock.calls[0][0].fieldConfig as FieldConfigItem[]
    expect(cfg.find((i) => i.field_id === 'f-risks')?.section_id).toBe('sec-forecast')
  })

  it('writes only the five canonical keys', async () => {
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')
    expandSection(/Thesis & Risks/)
    fireEvent.click(screen.getByLabelText('Move Risks down'))
    save()

    await waitFor(() => expect(updateLayout.mutateAsync).toHaveBeenCalled())
    const arg = updateLayout.mutateAsync.mock.calls[0][0]
    expect(Object.keys(arg).sort()).toEqual(['fieldConfig', 'layoutId', 'name'])
    for (const item of arg.fieldConfig as FieldConfigItem[]) {
      expect(Object.keys(item).sort()).toEqual(
        ['display_order', 'field_id', 'is_collapsed', 'is_visible', 'section_id'],
      )
    }
  })

  it('does not adopt fields the stored layout never listed', async () => {
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')
    expandSection(/Thesis & Risks/)
    fireEvent.click(screen.getByLabelText('Move Risks down'))
    save()

    await waitFor(() => expect(updateLayout.mutateAsync).toHaveBeenCalled())
    const cfg = updateLayout.mutateAsync.mock.calls[0][0].fieldConfig as FieldConfigItem[]
    expect(cfg.map((i) => i.field_id)).not.toContain('f-model')
  })

  it('keeps Save inert until something changes', async () => {
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()

    expandSection(/Thesis & Risks/)
    // Expanding is a view change, not an edit.
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Move Risks down'))
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled()
  })

  it('surfaces a failed save instead of swallowing it', async () => {
    updateLayout.mutateAsync.mockRejectedValueOnce(new Error('permission denied for table'))
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')
    expandSection(/Thesis & Risks/)
    fireEvent.click(screen.getByLabelText('Move Risks down'))
    save()

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i)
  })
})

describe('authority', () => {
  it('never renders a create-field or create-section affordance', async () => {
    layouts = [CUSTOM]
    await openLayout(customRow('Deep dive'))
    await screen.findByText('Thesis & Risks')

    expect(screen.queryByRole('button', { name: /add section/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new field/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add field/i })).not.toBeInTheDocument()
  })

  it('tells a non-admin it is an admin job, not a desktop job', async () => {
    layouts = [CUSTOM]
    isOrgAdmin = false
    await openLayout(customRow('Deep dive'))

    expect(await screen.findByText(/created by an organization admin/i)).toBeInTheDocument()
    expect(screen.queryByText(/created on desktop/i)).not.toBeInTheDocument()
  })

  it('tells an admin it is a real deferral to desktop', async () => {
    layouts = [CUSTOM]
    isOrgAdmin = true
    await openLayout(customRow('Deep dive'))

    expect(await screen.findByText(/created on desktop/i)).toBeInTheDocument()
  })

  it('offers no save and disabled controls to a view-only collaborator', async () => {
    layouts = [{ ...CUSTOM, my_permission: 'view', is_shared_with_me: true }]
    await openLayout(customRow('Deep dive'))
    await screen.findByText('View only')

    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    expandSection(/Thesis & Risks/)
    expect(screen.getByLabelText('Hide Risks')).toBeDisabled()
    expect(screen.getByLabelText('Move Risks down')).toBeDisabled()
  })
})
