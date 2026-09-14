/**
 * Trade Book rationale at 390px.
 *
 * The Decision rationale editor was a 3-row box with two 11px controls, and
 * its saved state pinned a small Edit chip over the first line of text. The
 * per-trade note was a one-line input beside its button, which cut the
 * placeholder off. On a phone both are now full-width fields that grow, with
 * their actions as a proper row underneath that stays in view when the
 * keyboard opens. Same fields, same writes; desktop markup unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const update = vi.fn()
let saveResult: { data: unknown[] | null; error: unknown } = { data: [{ id: 'b-1' }], error: null }

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (values: unknown) => {
        update(values)
        return { eq: () => ({ select: () => Promise.resolve(saveResult) }) }
      },
    }),
  },
}))

let comments: Array<{ id: string; content: string; created_at: string; user?: { first_name?: string } }> = []
vi.mock('../../../hooks/useAcceptedTrades', () => ({
  useAcceptedTradeComments: () => ({ data: comments }),
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }))

import { BatchRationaleEditor } from '../BatchListView'
import { TradeRationaleLog } from '../AcceptedTradesTable'
import { MobileNoteField } from '../../mobile/MobileNoteField'

let mobile = true
const setViewport = (isMobile: boolean) => {
  mobile = isMobile
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === '(max-width: 767px)' ? mobile : false,
    addEventListener() {}, removeEventListener() {},
  }))
}

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
const batch = (description: string | null) => ({ id: 'b-1', description, updated_at: '2026-09-14T00:00:00Z' }) as never

beforeEach(() => {
  setViewport(true)
  update.mockReset()
  saveResult = { data: [{ id: 'b-1' }], error: null }
  comments = []
})
afterEach(() => vi.unstubAllGlobals())

describe('Decision rationale on a phone', () => {
  it('opens a full-width editor with a readable starting height and the whole placeholder', () => {
    wrap(<BatchRationaleEditor batch={batch(null)} />)
    fireEvent.click(screen.getByText('Add rationale to explain this decision'))
    const field = screen.getByLabelText('Decision rationale') as HTMLTextAreaElement
    expect(field.tagName).toBe('TEXTAREA')
    expect(field.rows).toBe(4)
    expect(field.className).toContain('w-full')
    expect(field.className).toContain('resize-none')
    expect(field.getAttribute('placeholder')).toBe("Why these trades? What's the thesis for the batch?")
  })

  it('puts Cancel and Save in a footer row under the field, with Save the primary', () => {
    const { container } = wrap(<BatchRationaleEditor batch={batch(null)} />)
    fireEvent.click(screen.getByText('Add rationale to explain this decision'))
    const field = screen.getByLabelText('Decision rationale')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const save = screen.getByRole('button', { name: /Save rationale/ })
    // Below the field, in document order, in one row.
    expect(field.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(cancel.parentElement).toBe(save.parentElement)
    expect(save.className).toContain('flex-[2]')
    expect(save.className).toContain('bg-amber-600')
    expect(save.className).toContain('h-11')
    expect(container.querySelector('[data-slot="batch-rationale-editor-mobile"]')).not.toBeNull()
  })

  it('looks disabled only while it is: nothing typed, then enabled once there is text', () => {
    wrap(<BatchRationaleEditor batch={batch(null)} />)
    fireEvent.click(screen.getByText('Add rationale to explain this decision'))
    const save = screen.getByRole('button', { name: /Save rationale/ }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Decision rationale'), { target: { value: 'Adding on weakness ahead of the print.' } })
    expect(save.disabled).toBe(false)
  })

  it('saves to trade_batches.description and shows the text with Edit on its own row', async () => {
    const { container } = wrap(<BatchRationaleEditor batch={batch(null)} />)
    fireEvent.click(screen.getByText('Add rationale to explain this decision'))
    fireEvent.change(screen.getByLabelText('Decision rationale'), { target: { value: 'Adding on weakness ahead of the print.' } })
    fireEvent.click(screen.getByRole('button', { name: /Save rationale/ }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toMatchObject({ description: 'Adding on weakness ahead of the print.' })
    await waitFor(() => expect(screen.queryByLabelText('Decision rationale')).toBeNull())
    void container
  })

  it('shows a saved rationale as text, with an Edit action that does not overlap it', () => {
    const { container } = wrap(<BatchRationaleEditor batch={batch('Adding on weakness ahead of the print.')} />)
    const saved = container.querySelector('[data-slot="batch-rationale-saved-mobile"]') as HTMLElement
    const text = saved.querySelector('p') as HTMLElement
    const edit = saved.querySelector('[data-slot="batch-rationale-edit-mobile"]') as HTMLElement
    expect(text.textContent).toBe('Adding on weakness ahead of the print.')
    expect(edit.textContent).toContain('Edit rationale')
    // Not stacked over the text: no absolute positioning, and the button is in
    // its own row after the paragraph.
    expect(saved.innerHTML).not.toContain('absolute')
    expect(text.contains(edit)).toBe(false)
    expect(text.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('reopens the same editor with the current text when editing', () => {
    wrap(<BatchRationaleEditor batch={batch('Adding on weakness ahead of the print.')} />)
    fireEvent.click(screen.getByRole('button', { name: /Edit rationale/ }))
    expect((screen.getByLabelText('Decision rationale') as HTMLTextAreaElement).value).toBe('Adding on weakness ahead of the print.')
    // Unchanged text cannot be "saved" again.
    expect((screen.getByRole('button', { name: /Save rationale/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the editor open and says why when the save is refused', async () => {
    saveResult = { data: [], error: null }
    wrap(<BatchRationaleEditor batch={batch(null)} />)
    fireEvent.click(screen.getByText('Add rationale to explain this decision'))
    fireEvent.change(screen.getByLabelText('Decision rationale'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /Save rationale/ }))
    await screen.findByText("Couldn't save rationale — permission denied or batch not found.")
    expect(screen.getByLabelText('Decision rationale')).toBeTruthy()
  })
})

describe('Decision rationale on desktop is unchanged', () => {
  it('keeps the hover Edit chip and the compact editor', () => {
    setViewport(false)
    const { container } = wrap(<BatchRationaleEditor batch={batch('Some rationale')} />)
    expect(container.querySelector('[data-slot="batch-rationale-edit"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="batch-rationale-saved-mobile"]')).toBeNull()
    fireEvent.click(container.querySelector('[data-slot="batch-rationale-edit"]')!)
    expect(container.querySelector('[data-slot="batch-rationale-editor-mobile"]')).toBeNull()
    expect((container.querySelector('textarea') as HTMLTextAreaElement).rows).toBe(3)
  })
})

describe('Trade rationale notes on a phone', () => {
  it('gives the note a full-width field with the whole placeholder, and Add note below it', () => {
    wrap(<TradeRationaleLog tradeId="t-1" acceptanceNote="Reason at commit" batchDescription="Batch why" onAddComment={vi.fn()} />)
    const field = screen.getByLabelText('Add to trade rationale') as HTMLTextAreaElement
    expect(field.tagName).toBe('TEXTAREA')
    expect(field.className).toContain('w-full')
    expect(field.getAttribute('placeholder')).toBe("Add to rationale — what's changed, what you learned...")
    const add = screen.getByRole('button', { name: 'Add note' })
    expect(add.className).toContain('w-full')
    expect(field.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('adds the note through the same handler and clears the field', () => {
    const onAddComment = vi.fn()
    wrap(<TradeRationaleLog tradeId="t-1" acceptanceNote={null} onAddComment={onAddComment} />)
    const add = screen.getByRole('button', { name: 'Add note' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Add to trade rationale'), { target: { value: 'Guidance raised.' } })
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    expect(onAddComment).toHaveBeenCalledWith('t-1', 'Guidance raised.')
    expect((screen.getByLabelText('Add to trade rationale') as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps the commit-time reason visually apart from later notes', () => {
    comments = [{ id: 'c-1', content: 'Guidance raised.', created_at: '2026-09-14T12:00:00Z', user: { first_name: 'Dana' } }]
    const { container } = wrap(<TradeRationaleLog tradeId="t-1" acceptanceNote="Reason at commit" onAddComment={vi.fn()} />)
    const initial = container.querySelector('[data-slot="trade-rationale-initial"]') as HTMLElement
    const additions = container.querySelector('[data-slot="trade-rationale-additions"]') as HTMLElement
    expect(initial.textContent).toContain('At commit')
    expect(initial.textContent).toContain('Reason at commit')
    expect(initial.className).toContain('border-l-2')
    expect(additions.textContent).toContain('Added')
    expect(additions.textContent).toContain('Guidance raised.')
    expect(initial.contains(additions)).toBe(false)
  })

  it('shows an inherited batch rationale as inherited and does not ask for it again', () => {
    const { container } = wrap(<TradeRationaleLog tradeId="t-1" acceptanceNote="Batch why" batchDescription="Batch why" onAddComment={vi.fn()} />)
    const initial = container.querySelector('[data-slot="trade-rationale-initial"]') as HTMLElement
    expect(initial.textContent).toContain('From batch rationale')
    expect(initial.textContent).toContain('Batch why')
    // The field adds to the log; it is not a second place to write the batch rationale.
    expect(screen.getByLabelText('Add to trade rationale').getAttribute('placeholder')).not.toMatch(/batch|thesis/i)
  })
})

describe('Trade rationale notes on desktop are unchanged', () => {
  it('keeps the one-line input beside its button', () => {
    setViewport(false)
    const { container } = wrap(<TradeRationaleLog tradeId="t-1" acceptanceNote="Reason" onAddComment={vi.fn()} />)
    expect(container.querySelector('[data-slot="trade-rationale-mobile"]')).toBeNull()
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.nextElementSibling?.textContent).toBe('Add note')
  })
})

describe('the note field keeps its actions reachable', () => {
  const field = () => wrap(
    <MobileNoteField value="" onChange={vi.fn()} placeholder="p" actions={<button type="button">Save</button>} />,
  )

  it('brings the actions into view when the field is focused', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1 })
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    field()
    fireEvent.focus(screen.getByLabelText('p'))
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
  })

  it('does it again when the keyboard resizes the visual viewport while focused', () => {
    const listeners: Record<string, () => void> = {}
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { addEventListener: (t: string, fn: () => void) => { listeners[t] = fn }, removeEventListener() {} } })
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    field()
    listeners.resize()
    expect(scroll).not.toHaveBeenCalled() // not focused: leave the page alone
    screen.getByLabelText('p').focus()
    scroll.mockClear()
    listeners.resize()
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
  })

  it('grows with its content instead of scrolling inside the page', () => {
    const { container } = wrap(<MobileNoteField value="one" onChange={vi.fn()} placeholder="p" actions={null} />)
    const area = container.querySelector('textarea') as HTMLTextAreaElement
    expect(area.className).toContain('overflow-hidden')
    expect(area.style.height).toMatch(/px$/)
  })
})
