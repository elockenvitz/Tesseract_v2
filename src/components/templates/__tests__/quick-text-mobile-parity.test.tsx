/**
 * Quick Text: a phone and a desktop must write the same template.
 *
 * ── What this is really testing ────────────────────────────────────────────
 *
 * Identical pixels are not the goal and never were. The goal is that a
 * template authored on one device opens and saves correctly on the other,
 * because both write the SAME `TemplateFormData` through the SAME validation
 * to the SAME canonical `text_templates` row.
 *
 * The mobile chrome is a different frame around one editor, not a second
 * editor — so the risk being pinned here is that the two frames drift into
 * two behaviours: a phone that skips a validation a desktop enforces, or
 * emits a field the desktop does not, or loses one it does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MOBILE_QUERY } from '../../../hooks/useMediaQuery'
import { TemplateEditor, type TemplateFormData } from '../TemplateEditor'

// The rich-text editor is a TipTap instance; this exercises the form around
// it, so it is replaced with a plain textarea that reports the same
// (html, plainText) pair its onChange contract promises.
vi.mock('../../rich-text-editor/RichTextEditor', () => ({
  RichTextEditor: ({ onChange, placeholder }: any) => (
    <textarea
      data-testid="rte"
      placeholder={placeholder}
      onChange={(e) => onChange(`<p>${e.target.value}</p>`, e.target.value)}
    />
  ),
}))
vi.mock('../TemplateTagPicker', () => ({ TemplateTagPicker: () => null }))

function setViewport(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query === MOBILE_QUERY,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

/** A template as the desktop would have saved it. */
const DESKTOP_FIXTURE = {
  id: 't1',
  name: 'Earnings recap',
  content: 'Hello {{company}}, price is {{.price:AAPL}}.',
  content_html: '<p>Hello {{company}}, price is {{.price:AAPL}}.</p>',
  description: 'Quarterly note',
  category: 'analysis',
  shortcut: 'erec',
  variables: [],
  is_shared: false,
  usage_count: 3,
  user_id: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as any

afterEach(() => vi.restoreAllMocks())

describe('a desktop-authored template opens on a phone', () => {
  beforeEach(() => setViewport(true))

  it('shows the stored name, category and shortcut — nothing is dropped', () => {
    render(<TemplateEditor template={DESKTOP_FIXTURE} onSave={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByLabelText(/template name/i)).toHaveValue('Earnings recap')
    // Category is surfaced as the shell's meta line.
    expect(screen.getByText('Analysis')).toBeInTheDocument()

    // Shortcut lives behind the settings disclosure, not lost.
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
    expect(screen.getByDisplayValue('erec')).toBeInTheDocument()
  })

  it('renders the phone chrome and NOT a second copy of the desktop chrome', () => {
    render(<TemplateEditor template={DESKTOP_FIXTURE} onSave={vi.fn()} onCancel={vi.fn()} />)

    // Exactly one name field, one save. Rendering both chromes and hiding one
    // would double these in the DOM.
    expect(screen.getAllByLabelText(/template name/i)).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /update/i })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /close editor/i })).not.toBeInTheDocument()
  })
})

describe('the phone saves the same shape the desktop saves', () => {
  it('emits an identical TemplateFormData for an identical edit', async () => {
    const mobileSave = vi.fn().mockResolvedValue(undefined)
    setViewport(true)
    const mobile = render(
      <TemplateEditor template={DESKTOP_FIXTURE} onSave={mobileSave} onCancel={vi.fn()} />,
    )
    fireEvent.change(mobile.getByTestId ? screen.getByTestId('rte') : screen.getByTestId('rte'), {
      target: { value: 'Edited body' },
    })
    fireEvent.click(screen.getByRole('button', { name: /update/i }))
    await waitFor(() => expect(mobileSave).toHaveBeenCalled())
    mobile.unmount()

    const desktopSave = vi.fn().mockResolvedValue(undefined)
    setViewport(false)
    render(<TemplateEditor template={DESKTOP_FIXTURE} onSave={desktopSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId('rte'), { target: { value: 'Edited body' } })
    fireEvent.click(screen.getByRole('button', { name: /update/i }))
    await waitFor(() => expect(desktopSave).toHaveBeenCalled())

    const fromMobile: TemplateFormData = mobileSave.mock.calls[0][0]
    const fromDesktop: TemplateFormData = desktopSave.mock.calls[0][0]

    // The whole point: byte-identical payloads, same keys, same values.
    expect(fromMobile).toEqual(fromDesktop)
    expect(Object.keys(fromMobile).sort()).toEqual(Object.keys(fromDesktop).sort())
    expect(fromMobile.content).toBe('Edited body')
    expect(fromMobile.content_html).toBe('<p>Edited body</p>')
    // Fields the phone never showed must survive untouched.
    expect(fromMobile.shortcut).toBe('erec')
    expect(fromMobile.category).toBe('analysis')
    expect(fromMobile.description).toBe('Quarterly note')
  })

  it('writes no key the desktop does not write', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    setViewport(true)
    render(<TemplateEditor template={DESKTOP_FIXTURE} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /update/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    expect(Object.keys(onSave.mock.calls[0][0]).sort()).toEqual(
      ['category', 'content', 'content_html', 'description', 'name', 'shortcut', 'tag_ids'].sort(),
    )
  })
})

describe('the phone enforces the same validation', () => {
  beforeEach(() => setViewport(true))

  it('refuses an empty name, exactly as the desktop does', async () => {
    const onSave = vi.fn()
    render(<TemplateEditor onSave={onSave} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(await screen.findByText(/template name is required/i)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses empty content', async () => {
    const onSave = vi.fn()
    render(<TemplateEditor onSave={onSave} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/template name/i), { target: { value: 'Named' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(await screen.findByText(/template content is required/i)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('a phone-authored template reopens on the desktop', () => {
  it('round-trips a mobile save back into the desktop editor unchanged', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    setViewport(true)
    const phone = render(<TemplateEditor onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/template name/i), { target: { value: 'From phone' } })
    fireEvent.change(screen.getByTestId('rte'), { target: { value: 'Body {{ticker}}' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    phone.unmount()

    // Persist it the way the manager would, then reopen on a desktop.
    const saved = onSave.mock.calls[0][0] as TemplateFormData
    const asRow = { ...DESKTOP_FIXTURE, ...saved, id: 't2' }

    setViewport(false)
    render(<TemplateEditor template={asRow} onSave={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByDisplayValue('From phone')).toBeInTheDocument()
    // The desktop chrome is back, and it is the only chrome.
    expect(screen.getByRole('button', { name: /close editor/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument()
  })
})
