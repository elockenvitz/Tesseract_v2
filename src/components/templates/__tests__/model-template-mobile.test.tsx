/**
 * Excel Extraction on a phone: references without a workbook.
 *
 * The desktop assigns `FieldMapping.cell` only by clicking a rendered grid,
 * so the reference is well-formed by construction. A phone has no grid, and
 * what this file pins is that the strings it produces instead are the SAME
 * strings — bare when no sheet is named, qualified when one is, never quoted
 * — and that the things a phone genuinely cannot author are carried through
 * rather than dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MobileModelTemplateEditor } from '../mobile/MobileModelTemplateEditor'
import type { ModelTemplate } from '../../../hooks/useModelTemplates'

const createTemplate = { mutateAsync: vi.fn().mockResolvedValue({ id: 'new' }) }
const updateTemplate = { mutateAsync: vi.fn().mockResolvedValue(undefined) }

const TEMPLATE: ModelTemplate = {
  id: 'mt-1',
  name: 'One-pager',
  description: 'Standard model',
  field_mappings: [
    { field: 'price_target', cell: 'Summary!B5', type: 'currency', label: 'Price Target' },
    { field: 'rating', cell: 'B7', type: 'text', label: 'Rating' },
  ],
  // A phone cannot author these — it must not drop them either.
  dynamic_mappings: [
    {
      id: 'dyn-1',
      name: 'EPS by year',
      field_pattern: 'eps_{year}',
      row_match: { label_contains: 'EPS', label_column: 'A', sheet: 'Model' },
      column_match: { header_row: 3, start_column: 'C', end_column: 'H' },
      type: 'currency',
    } as ModelTemplate['dynamic_mappings'] extends (infer T)[] | undefined ? T : never,
  ],
  snapshot_ranges: [{ name: 'Summary', range: 'Summary!A1:H30' }],
  detection_rules: { filename_patterns: ['*OnePager*'], sheet_names: ['Summary'] },
  is_firm_template: false,
  organization_id: null,
  created_by: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

let myTemplates: ModelTemplate[] = [TEMPLATE]

vi.mock('../../../hooks/useModelTemplates', async (importOriginal) => {
  // The catalogs and generateFieldMapping are real: a phone must not be able
  // to invent a field name the desktop would not recognise, and mocking them
  // away would hide exactly that.
  const actual = await importOriginal<typeof import('../../../hooks/useModelTemplates')>()
  return {
    ...actual,
    useModelTemplates: () => ({
      myTemplates,
      sharedTemplates: [],
      isLoading: false,
      createTemplate,
      updateTemplate,
    }),
  }
})

beforeEach(() => {
  myTemplates = [TEMPLATE]
  createTemplate.mutateAsync.mockClear()
  updateTemplate.mutateAsync.mockClear()
})
afterEach(() => vi.clearAllMocks())

async function openTemplate() {
  render(<MobileModelTemplateEditor onBack={vi.fn()} />)
  fireEvent.click(await screen.findByText('One-pager'))
  return await screen.findByRole('button', { name: /^save$/i })
}

describe('a desktop-authored template opens on a phone', () => {
  it('splits a stored reference into its sheet and its cell', async () => {
    await openTemplate()

    expect(screen.getByLabelText('Sheet for Price Target')).toHaveValue('Summary')
    expect(screen.getByLabelText('Cell for Price Target')).toHaveValue('B5')
  })

  it('shows a bare reference with an empty sheet, not an invented one', async () => {
    // 'B7' came from a single-sheet workbook. Guessing a sheet here is how a
    // reference silently starts pointing somewhere else.
    await openTemplate()

    expect(screen.getByLabelText('Sheet for Rating')).toHaveValue('')
    expect(screen.getByLabelText('Cell for Rating')).toHaveValue('B7')
  })

  it('splits a snapshot range into sheet, start and end', async () => {
    await openTemplate()

    expect(screen.getByLabelText('Sheet for range 1')).toHaveValue('Summary')
    expect(screen.getByLabelText('Start cell for range 1')).toHaveValue('A1')
    expect(screen.getByLabelText('End cell for range 1')).toHaveValue('H30')
  })

  it('offers the sheets the template already uses', async () => {
    // How a phone knows a sheet name without opening the workbook.
    await openTemplate()
    const row = screen.getByLabelText('Cell for Rating').closest('div')!.parentElement!
    expect(within(row).getByRole('button', { name: 'Summary' })).toBeInTheDocument()
  })
})

describe('what a phone writes back', () => {
  it('re-emits an untouched template byte for byte', async () => {
    const save = await openTemplate()
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate.mutateAsync).toHaveBeenCalled())
    const arg = updateTemplate.mutateAsync.mock.calls[0][0]

    expect(arg.fieldMappings).toEqual(TEMPLATE.field_mappings)
    expect(arg.snapshotRanges).toEqual(TEMPLATE.snapshot_ranges)
    expect(arg.detectionRules).toEqual(TEMPLATE.detection_rules)
  })

  it('qualifies a reference when a sheet is named', async () => {
    const save = await openTemplate()
    fireEvent.change(screen.getByLabelText('Sheet for Rating'), { target: { value: 'Model' } })
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate.mutateAsync).toHaveBeenCalled())
    const mappings = updateTemplate.mutateAsync.mock.calls[0][0].fieldMappings
    expect(mappings.find((m: any) => m.field === 'rating').cell).toBe('Model!B7')
  })

  it('leaves a reference bare when the sheet is cleared', async () => {
    const save = await openTemplate()
    fireEvent.change(screen.getByLabelText('Sheet for Price Target'), { target: { value: '' } })
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate.mutateAsync).toHaveBeenCalled())
    const mappings = updateTemplate.mutateAsync.mock.calls[0][0].fieldMappings
    expect(mappings.find((m: any) => m.field === 'price_target').cell).toBe('B5')
  })

  it('does not quote a sheet name with spaces, matching the grid', async () => {
    // A quoted name would not resolve: the parser does not strip quotes and
    // the lookup would silently fall back to the first sheet.
    const save = await openTemplate()
    fireEvent.change(screen.getByLabelText('Sheet for Rating'), {
      target: { value: 'Model Sheet' },
    })
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate.mutateAsync).toHaveBeenCalled())
    const mappings = updateTemplate.mutateAsync.mock.calls[0][0].fieldMappings
    expect(mappings.find((m: any) => m.field === 'rating').cell).toBe('Model Sheet!B7')
  })

  it('carries dynamic mappings through untouched', async () => {
    // Built on desktop against a live workbook. Dropping them would delete
    // work a phone cannot even display.
    const save = await openTemplate()
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate.mutateAsync).toHaveBeenCalled())
    expect(updateTemplate.mutateAsync.mock.calls[0][0].dynamicMappings).toEqual(
      TEMPLATE.dynamic_mappings,
    )
  })

  it('says the dynamic mappings are there rather than hiding them', async () => {
    await openTemplate()
    expect(screen.getByText(/1 built on desktop/i)).toBeInTheDocument()
  })

  it('never sends a key the hook owns', async () => {
    const save = await openTemplate()
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate.mutateAsync).toHaveBeenCalled())
    const arg = updateTemplate.mutateAsync.mock.calls[0][0]

    // created_by is what RLS checks; the other two decide who can read it.
    expect(arg).not.toHaveProperty('created_by')
    expect(arg).not.toHaveProperty('organization_id')
    expect(arg).not.toHaveProperty('isFirmTemplate')
    expect(Object.keys(arg).sort()).toEqual([
      'description',
      'detectionRules',
      'dynamicMappings',
      'fieldMappings',
      'id',
      'name',
      'snapshotRanges',
    ])
  })
})

describe('creating a template', () => {
  it('seeds dynamicMappings as [] and not null, as the desktop stores it', async () => {
    render(<MobileModelTemplateEditor onBack={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /new template/i }))
    fireEvent.change(await screen.findByLabelText(/template name/i), {
      target: { value: 'From phone' },
    })

    fireEvent.click(screen.getByRole('button', { name: /add field/i }))
    fireEvent.click(await screen.findByRole('button', { name: /model currency/i }))
    fireEvent.change(screen.getByLabelText(/^Cell for Model Currency$/), {
      target: { value: 'B2' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(createTemplate.mutateAsync).toHaveBeenCalled())
    const arg = createTemplate.mutateAsync.mock.calls[0][0]

    expect(arg.dynamicMappings).toEqual([])
    expect(arg.dynamicMappings).not.toBeNull()
    expect(arg.snapshotRanges).toEqual([])
    expect(arg.detectionRules).toEqual({})
  })

  it('builds the mapping from the shared catalog, not an invented name', async () => {
    render(<MobileModelTemplateEditor onBack={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /new template/i }))
    fireEvent.change(await screen.findByLabelText(/template name/i), { target: { value: 'X' } })

    fireEvent.click(screen.getByRole('button', { name: /add field/i }))
    fireEvent.click(await screen.findByRole('button', { name: /model currency/i }))
    fireEvent.change(screen.getByLabelText(/^Cell for Model Currency$/), {
      target: { value: 'b2' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(createTemplate.mutateAsync).toHaveBeenCalled())
    const mapping = createTemplate.mutateAsync.mock.calls[0][0].fieldMappings[0]

    expect(mapping.field).toBe('model_currency')
    expect(mapping.type).toBe('text')
    expect(mapping.isPreset).toBe(true)
    // Typed lower case, stored upper — the grid's own normalisation.
    expect(mapping.cell).toBe('B2')
  })
})

describe('validation a phone needs and the desktop never had', () => {
  it('refuses a template with no mappings, as the desktop does', async () => {
    render(<MobileModelTemplateEditor onBack={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /new template/i }))
    fireEvent.change(await screen.findByLabelText(/template name/i), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one field mapping/i)
    expect(createTemplate.mutateAsync).not.toHaveBeenCalled()
  })

  it('refuses a malformed cell reference and names it', async () => {
    const save = await openTemplate()
    fireEvent.change(screen.getByLabelText('Cell for Rating'), { target: { value: 'NOPE' } })
    fireEvent.click(save)

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a cell reference/i)
    expect(updateTemplate.mutateAsync).not.toHaveBeenCalled()
  })

  it('surfaces a failed save instead of swallowing it', async () => {
    updateTemplate.mutateAsync.mockRejectedValueOnce(new Error('permission denied for table'))
    const save = await openTemplate()
    fireEvent.click(save)

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i)
  })
})
