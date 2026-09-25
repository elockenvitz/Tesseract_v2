/**
 * Research Layout on a phone: authority, and the shape that reaches the DB.
 *
 * The round trip itself is pinned in src/lib/research/__tests__/layout-draft
 * against the pure model. What this file pins is the screen: that it offers
 * only what RLS permits, and that the payload handed to the existing
 * `saveLayout`/`updateLayout` mutations is the canonical `FieldConfigItem[]`
 * and nothing else.
 *
 * The authority case is the point. `research_fields` and `research_sections`
 * each carry one FOR ALL policy with a null WITH CHECK, so INSERT is gated on
 * `is_active_org_admin_of_current_org()`. The desktop renders Add Section and
 * Create New Field for everyone and swallows the 42501 in a console.error —
 * a button that does nothing and says nothing. A regression that copied those
 * buttons onto the phone would be invisible in review; it is not invisible
 * here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  /** Widened deliberately: the view-only cases below override it. */
  my_permission: 'owner' | 'admin' | 'edit' | 'view'
  field_config: FieldConfigItem[]
}

const LAYOUT: TestLayout = {
  id: 'lay-1',
  name: 'My layout',
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
  ],
}

let layouts: TestLayout[] = [LAYOUT]
let isOrgAdmin = false

vi.mock('../../../hooks/useUserAssetPagePreferences', () => ({
  useUserAssetPageLayouts: () => ({ layouts, isLoading: false, saveLayout, updateLayout }),
}))
vi.mock('../../../hooks/useResearchSections', () => ({}))
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
      { id: 'f-thesis', name: 'Thesis', field_type: 'rich_text', section_id: 'sec-thesis' },
      { id: 'f-risks', name: 'Risks', field_type: 'rich_text', section_id: 'sec-thesis' },
      { id: 'f-model', name: 'Business Model', field_type: 'rich_text', section_id: 'sec-thesis' },
      { id: 'f-rating', name: 'Rating', field_type: 'rating', section_id: 'sec-forecast' },
    ],
    isLoading: false,
  }),
}))
vi.mock('../../../hooks/useIsOrgAdmin', () => ({
  useIsOrgAdmin: () => ({ isOrgAdmin, isLoading: false, canAuthorCatalog: isOrgAdmin }),
}))

beforeEach(() => {
  layouts = [LAYOUT]
  isOrgAdmin = false
  saveLayout.mutateAsync.mockClear()
  updateLayout.mutateAsync.mockClear()
})
afterEach(() => vi.clearAllMocks())

/** Open the editor on the saved layout. */
async function openEditor() {
  render(<MobileResearchLayoutEditor onBack={vi.fn()} />)
  fireEvent.click(await screen.findByText('My layout'))
  return await screen.findByLabelText('Move Risks down')
}

describe('authority — the phone offers only what RLS permits', () => {
  it('never renders a create-field or create-section affordance', async () => {
    await openEditor()

    // The exact controls the desktop shows unconditionally and whose writes
    // Postgres rejects for a non-admin with 42501.
    expect(screen.queryByRole('button', { name: /add section/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new field/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create.*field/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add field/i })).not.toBeInTheDocument()
  })

  it('tells a non-admin the catalog is an admin job, not a desktop job', async () => {
    isOrgAdmin = false
    await openEditor()

    // Sending a non-admin to a desktop would be false — the button fails
    // there too, silently.
    expect(screen.getByText(/created by an organization admin/i)).toBeInTheDocument()
    expect(screen.queryByText(/is done on desktop/i)).not.toBeInTheDocument()
  })

  it('tells an admin it is a real deferral to desktop', async () => {
    isOrgAdmin = true
    await openEditor()

    expect(screen.getByText(/is done on desktop/i)).toBeInTheDocument()
  })

  it('offers no save to a view-only collaborator', async () => {
    layouts = [{ ...LAYOUT, my_permission: 'view', is_shared_with_me: true }]
    render(<MobileResearchLayoutEditor onBack={vi.fn()} />)
    fireEvent.click(await screen.findByText('My layout'))

    await screen.findByText('View only')
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    // And the name is a heading, not an input they cannot persist.
    expect(screen.queryByLabelText(/template name/i)).not.toBeInTheDocument()
  })

  it('disables the row controls for a view-only collaborator', async () => {
    layouts = [{ ...LAYOUT, my_permission: 'view', is_shared_with_me: true }]
    render(<MobileResearchLayoutEditor onBack={vi.fn()} />)
    fireEvent.click(await screen.findByText('My layout'))

    expect(await screen.findByLabelText('Hide Risks')).toBeDisabled()
    expect(screen.getByLabelText('Move Risks down')).toBeDisabled()
  })
})

describe('what reaches the database', () => {
  it('saves the canonical FieldConfigItem[] and no other key', async () => {
    await openEditor()
    fireEvent.click(screen.getByLabelText('Move Risks down'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(updateLayout.mutateAsync).toHaveBeenCalled())
    const arg = updateLayout.mutateAsync.mock.calls[0][0]

    expect(Object.keys(arg).sort()).toEqual(['fieldConfig', 'layoutId', 'name'])
    for (const item of arg.fieldConfig as FieldConfigItem[]) {
      expect(Object.keys(item).sort()).toEqual(
        ['display_order', 'field_id', 'is_collapsed', 'is_visible', 'section_id'],
      )
    }
  })

  it('persists the reorder the user actually performed', async () => {
    await openEditor()
    fireEvent.click(screen.getByLabelText('Move Risks down'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(updateLayout.mutateAsync).toHaveBeenCalled())
    const cfg = updateLayout.mutateAsync.mock.calls[0][0].fieldConfig as FieldConfigItem[]
    const thesis = cfg.filter((i) => i.section_id === 'sec-thesis')

    expect(thesis.map((i) => i.field_id)).toEqual(['f-thesis', 'f-risks'])
    expect(thesis.map((i) => i.display_order)).toEqual([0, 1])
  })

  it('does not begin listing fields the stored layout never listed', async () => {
    // f-model and f-rating are readable and unlisted. Merely opening and
    // saving must not adopt them — that would grow the row on every visit.
    await openEditor()
    fireEvent.click(screen.getByLabelText('Move Risks down'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(updateLayout.mutateAsync).toHaveBeenCalled())
    const cfg = updateLayout.mutateAsync.mock.calls[0][0].fieldConfig as FieldConfigItem[]
    expect(cfg.map((i) => i.field_id).sort()).toEqual(['f-risks', 'f-thesis'])
  })

  it('adds a field only when the user turns it on', async () => {
    await openEditor()
    fireEvent.click(screen.getByLabelText('Show Business Model'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(updateLayout.mutateAsync).toHaveBeenCalled())
    const cfg = updateLayout.mutateAsync.mock.calls[0][0].fieldConfig as FieldConfigItem[]
    const added = cfg.find((i) => i.field_id === 'f-model')

    expect(added).toBeDefined()
    expect(added!.is_visible).toBe(true)
    expect(added!.section_id).toBe('sec-thesis')
  })

  it('keeps Save inert until something actually changes', async () => {
    await openEditor()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Move Risks down'))
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled()
  })

  it('creates a new layout through saveLayout, not updateLayout', async () => {
    render(<MobileResearchLayoutEditor onBack={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /new layout/i }))

    fireEvent.change(await screen.findByLabelText(/template name/i), {
      target: { value: 'From phone' },
    })
    fireEvent.click(screen.getByLabelText('Show Thesis'))
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(saveLayout.mutateAsync).toHaveBeenCalled())
    expect(updateLayout.mutateAsync).not.toHaveBeenCalled()

    const arg = saveLayout.mutateAsync.mock.calls[0][0]
    // isDefault is deliberately absent: the phone does not start writing a
    // column the desktop leaves to its own flow.
    expect(Object.keys(arg).sort()).toEqual(['fieldConfig', 'name'])
    expect(arg.name).toBe('From phone')
  })

  it('refuses an unnamed layout and says so', async () => {
    render(<MobileResearchLayoutEditor onBack={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /new layout/i }))
    fireEvent.click(await screen.findByLabelText('Show Thesis'))
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/name is required/i)
    expect(saveLayout.mutateAsync).not.toHaveBeenCalled()
  })

  it('surfaces a failed save instead of swallowing it', async () => {
    // The desktop's console.error is exactly what this must not become.
    updateLayout.mutateAsync.mockRejectedValueOnce(new Error('permission denied for table'))
    await openEditor()
    fireEvent.click(screen.getByLabelText('Move Risks down'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i)
  })
})

describe('the list', () => {
  it('marks a shared view-only layout as such before it is opened', async () => {
    layouts = [{ ...LAYOUT, my_permission: 'view', is_shared_with_me: true }]
    render(<MobileResearchLayoutEditor onBack={vi.fn()} />)

    expect(await screen.findByText(/View only/)).toBeInTheDocument()
    expect(screen.getByText(/Shared with you/)).toBeInTheDocument()
  })
})
