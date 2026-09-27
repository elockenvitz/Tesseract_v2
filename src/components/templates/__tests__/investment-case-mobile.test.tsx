/**
 * Investment Case PDF on a phone: the steps, and what a save actually sends.
 *
 * The payload contract is pinned exhaustively against the pure builder in
 * src/lib/templates/__tests__/investment-case-payload. What this file adds is
 * the part a pure test cannot reach: that the SCREEN routes its save through
 * that builder, so the parity decision survives someone adding a control
 * later and wiring it straight to the mutation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MobileInvestmentCaseEditor } from '../mobile/MobileInvestmentCaseEditor'
import { STYLE_PRESETS } from '../../investment-case-templates/stylePresets'
import {
  DEFAULT_BRANDING_CONFIG,
  DEFAULT_COVER_CONFIG,
  DEFAULT_HEADER_FOOTER_CONFIG,
  DEFAULT_STYLE_CONFIG,
  DEFAULT_TOC_CONFIG,
  type InvestmentCaseTemplate,
} from '../../../types/investmentCaseTemplates'

const createTemplate = vi.fn().mockResolvedValue({ id: 'new' })
const updateTemplate = vi.fn().mockResolvedValue(undefined)

const TEMPLATE: InvestmentCaseTemplate = {
  id: 'tpl-1',
  name: 'Quarterly case',
  description: 'For the IC pack',
  user_id: 'u1',
  organization_id: null,
  is_shared: false,
  is_default: true,
  usage_count: 4,
  last_used_at: null,
  cover_config: DEFAULT_COVER_CONFIG,
  style_config: DEFAULT_STYLE_CONFIG,
  branding_config: DEFAULT_BRANDING_CONFIG,
  header_footer_config: DEFAULT_HEADER_FOOTER_CONFIG,
  // Deliberately non-empty: a mobile save must neither persist nor clear it.
  section_config: [
    { id: 's1', name: 'Thesis', enabled: true, order: 0, fields: [] },
  ],
  toc_config: DEFAULT_TOC_CONFIG,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

let myTemplates: InvestmentCaseTemplate[] = [TEMPLATE]

vi.mock('../../../hooks/useInvestmentCaseTemplates', () => ({
  useInvestmentCaseTemplates: () => ({
    myTemplates,
    sharedTemplates: [],
    isLoading: false,
    createTemplate,
    updateTemplate,
  }),
}))

// Structure reads the SAME hook the desktop preview derives its section
// order from. `Empty Section` has no fields, so it contributes no pages and
// must not be listed.
vi.mock('../../../hooks/useResearchFields', () => ({
  useUserResearchLayout: () => ({
    sections: [
      {
        section: { id: 'sec-thesis', name: 'Thesis & Risks' },
        fields: [{ field: { id: 'f1', slug: 'thesis', name: 'Thesis' } }],
      },
      {
        section: { id: 'sec-forecast', name: 'Forecasts & Estimates' },
        fields: [{ field: { id: 'f2', slug: 'rating', name: 'Rating' } }],
      },
      { section: { id: 'sec-empty', name: 'Empty Section' }, fields: [] },
    ],
    isLoading: false,
  }),
}))

// The preview renders paper pages from a fully hydrated template; this
// exercises the editor around it, not its typography.
vi.mock('../../investment-case-templates', () => ({
  InvestmentCaseTemplatePreview: ({ template }: { template: InvestmentCaseTemplate }) => (
    <div data-testid="preview" data-name={template.name} />
  ),
}))

beforeEach(() => {
  myTemplates = [TEMPLATE]
  createTemplate.mockClear()
  updateTemplate.mockClear()
})
afterEach(() => vi.clearAllMocks())

async function openTemplate() {
  render(<MobileInvestmentCaseEditor onBack={vi.fn()} />)
  fireEvent.click(await screen.findByText('Quarterly case'))
  return await screen.findByRole('button', { name: /^save$/i })
}

describe('parity — the two omitted columns stay omitted', () => {
  it('never sends section_config or is_default on update', async () => {
    const save = await openTemplate()
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    const payload = updateTemplate.mock.calls[0][1]

    expect(payload).not.toHaveProperty('section_config')
    expect(payload).not.toHaveProperty('is_default')
  })

  it('never sends them on create either', async () => {
    render(<MobileInvestmentCaseEditor onBack={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /new template/i }))
    fireEvent.change(await screen.findByLabelText(/template name/i), {
      target: { value: 'From phone' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(createTemplate).toHaveBeenCalled())
    const payload = createTemplate.mock.calls[0][0]

    expect(payload).not.toHaveProperty('section_config')
    expect(payload).not.toHaveProperty('is_default')
  })

  it('sends exactly the desktop key set and nothing else', async () => {
    const save = await openTemplate()
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(Object.keys(updateTemplate.mock.calls[0][1]).sort()).toEqual(
      [
        'branding_config',
        'cover_config',
        'description',
        'header_footer_config',
        'is_shared',
        'name',
        'style_config',
        'toc_config',
      ],
    )
  })

  it('does not clear a populated section_config by saving from a phone', async () => {
    // The row carries one section. Because the key is absent from the update
    // payload, Postgres leaves the column alone — the phone neither adopts
    // nor destroys it.
    const save = await openTemplate()
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(Object.keys(updateTemplate.mock.calls[0][1])).not.toContain('section_config')
  })

  it('offers no Sections step, because the desktop has no Sections tab', async () => {
    await openTemplate()
    expect(screen.queryByRole('button', { name: /^\d*\s*sections?$/i })).not.toBeInTheDocument()
  })

  it('offers no "set as default" control', async () => {
    // is_default belongs to the separate setDefaultTemplate mutation and a DB
    // trigger. An ordinary save must not be able to steal the default flag.
    await openTemplate()
    expect(screen.queryByRole('switch', { name: /default/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /default/i })).not.toBeInTheDocument()
  })
})

describe('the steps are ordered by question, not by config object', () => {
  it('shows Content, Structure, Style and Preview in order', async () => {
    // The desktop rail is filed by which config object a control writes,
    // which is a poor sequence to walk on a phone. These are the questions:
    // what goes in it, in what order, what it looks like, then look at it.
    await openTemplate()
    const steps = screen.getByRole('navigation', { name: /editor steps/i })
    const labels = Array.from(steps.querySelectorAll('button')).map((b) => b.textContent?.trim())

    expect(labels).toEqual(['1Content', '2Structure', '3Style', '4Preview'])
  })

  it('opens on Content and moves between steps in any direction', async () => {
    await openTemplate()
    expect(screen.getByRole('switch', { name: /include disclaimer/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /3Style/ }))
    expect(screen.getByRole('button', { name: /Branding/ })).toBeInTheDocument()

    // Back to an earlier step — not a one-way wizard.
    fireEvent.click(screen.getByRole('button', { name: /1Content/ }))
    expect(screen.getByRole('switch', { name: /include disclaimer/i })).toBeInTheDocument()
  })

  it('puts the table of contents on Content, as the desktop puts it on Cover', async () => {
    await openTemplate()
    expect(screen.getByRole('switch', { name: /include contents page/i })).toBeInTheDocument()
  })

  it('groups the three presentation configs behind disclosures, not three steps', async () => {
    await openTemplate()
    fireEvent.click(screen.getByRole('button', { name: /3Style/ }))

    // Presentation is one question; showing every control at once was the
    // long settings form the other types were corrected away from.
    expect(screen.getByRole('button', { name: /Branding/ })).toHaveAttribute(
      'aria-expanded', 'false',
    )
    fireEvent.click(screen.getByRole('button', { name: /Branding/ }))
    expect(screen.getByRole('switch', { name: /enable watermark/i })).toBeInTheDocument()
  })

  it('renders the preview from the live draft, not the saved row', async () => {
    await openTemplate()
    fireEvent.change(screen.getByLabelText(/template name/i), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: /4Preview/ }))

    expect(await screen.findAllByTestId('preview')).not.toHaveLength(0)
    expect(screen.getAllByTestId('preview')[0]).toHaveAttribute('data-name', 'Renamed')
  })

  it('opens preview full screen and returns without losing the draft', async () => {
    await openTemplate()
    fireEvent.change(screen.getByLabelText(/template name/i), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: /4Preview/ }))
    fireEvent.click(screen.getByRole('button', { name: /open full screen/i }))

    expect(screen.getByRole('button', { name: /back to editing/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /back to editing/i }))

    // A sibling view, not a navigation: the unsaved name survives.
    expect(screen.getByLabelText(/template name/i)).toHaveValue('Renamed')
  })
})

describe('Structure is inherited, and says so', () => {
  it('lists the participating sections in document order', async () => {
    await openTemplate()
    fireEvent.click(screen.getByRole('button', { name: /2Structure/ }))

    expect(screen.getByText(/Inherited from Research Layout/i)).toBeInTheDocument()
    expect(screen.getByText(/Section order is managed in Research Layout/i)).toBeInTheDocument()
    expect(screen.getByText('Thesis & Risks')).toBeInTheDocument()
  })

  it('offers no reorder or disabled controls — it does not own the order', async () => {
    // section_config is the only place order could live, it has no editor
    // anywhere in the product, and this type never persists it. Fake or
    // disabled handles would imply otherwise.
    await openTemplate()
    fireEvent.click(screen.getByRole('button', { name: /2Structure/ }))

    expect(screen.queryByLabelText(/move .* up/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/move .* down/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reorder/i })).not.toBeInTheDocument()
  })

  it('hides a section with no fields, which contributes no pages', async () => {
    await openTemplate()
    fireEvent.click(screen.getByRole('button', { name: /2Structure/ }))
    expect(screen.queryByText('Empty Section')).not.toBeInTheDocument()
  })

  it('still writes no section_config after visiting Structure', async () => {
    const save = await openTemplate()
    fireEvent.click(screen.getByRole('button', { name: /2Structure/ }))
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(updateTemplate.mock.calls[0][1]).not.toHaveProperty('section_config')
  })
})

describe('editing carries through to the payload', () => {
  it('sends the exact preset config the user picked', async () => {
    const preset = STYLE_PRESETS.find((p) => p.key === 'presentation')!
    const save = await openTemplate()
    fireEvent.click(screen.getByRole('button', { name: /3Style/ }))
    // 'Presentation' is unique; 'Compact' is a style preset, a margin, a text
    // size AND a density, so matching on it would be ambiguous by accident.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(preset.label) }))
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(updateTemplate.mock.calls[0][1].style_config).toEqual(preset.config)
  })

  it('reflects a margin choice in the payload, not just the chip', async () => {
    const save = await openTemplate()
    fireEvent.click(screen.getByRole('button', { name: /3Style/ }))
    const margins = screen.getByRole('group', { name: /margins/i })
    fireEvent.click(within(margins).getByRole('button', { name: 'Wide' }))
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(updateTemplate.mock.calls[0][1].style_config.margins).toEqual({
      top: 25, right: 25, bottom: 25, left: 25,
    })
  })

  it('turns an emptied description into null, matching the desktop', async () => {
    const save = await openTemplate()
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: '' } })
    fireEvent.click(save)

    await waitFor(() => expect(updateTemplate).toHaveBeenCalled())
    expect(updateTemplate.mock.calls[0][1].description).toBeNull()
  })

  it('refuses an unnamed template and says so', async () => {
    render(<MobileInvestmentCaseEditor onBack={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /new template/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^create$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/name is required/i)
    expect(createTemplate).not.toHaveBeenCalled()
  })

  it('surfaces a failed save instead of swallowing it', async () => {
    updateTemplate.mockRejectedValueOnce(new Error('permission denied for table'))
    const save = await openTemplate()
    fireEvent.click(save)

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i)
  })
})
