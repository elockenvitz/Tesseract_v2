/**
 * The Dialog primitive: the behaviour, not the markup.
 *
 * Each case here is something `ui/ConfirmDialog` does not do, which is why
 * adopting it was not an option. The one that matters most is the trap:
 * `aria-modal="true"` tells a screen reader the page behind is inert and does
 * nothing whatsoever to the tab order, so without the Tab handling a keyboard
 * user walks straight out of the dialog into the page it is covering and has
 * no way back except Shift+Tab through everything they passed.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { Dialog } from '../Dialog'

/** A page with an opener, so focus restoration has somewhere to restore to. */
function Harness({ withHoneypot = false }: { withHoneypot?: boolean } = {}) {
  const [open, setOpen] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <button type="button">Behind the dialog</button>
      {open && (
        <Dialog
          labelledBy="dlg-title"
          describedBy="dlg-desc"
          onClose={() => setOpen(false)}
          initialFocusRef={firstRef}
          data-testid="panel"
        >
          <>
            <h2 id="dlg-title">The title</h2>
            <p id="dlg-desc">The description</p>
            <input ref={firstRef} aria-label="First" />
            {withHoneypot && (
              <div aria-hidden="true">
                <input aria-label="Trap" tabIndex={-1} />
                <button type="button">Hidden control</button>
              </div>
            )}
            <button type="button">Last</button>
          </>
        </Dialog>
      )}
    </div>
  )
}

afterEach(() => { cleanup() })

describe('the dialog is announced as one', () => {
  it('has a role, a modal flag, a name and a description', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog).toHaveAccessibleName('The title')
    expect(dialog).toHaveAccessibleDescription('The description')
  })
})

describe('focus', () => {
  it('moves to the requested field rather than the first focusable element', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    expect(document.activeElement).toBe(screen.getByLabelText('First'))
  })

  it('returns to the control that opened it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)
    await user.keyboard('{Escape}')

    /*
     * The half that is easy to forget. Without it focus sits on
     * `document.body` and the next Tab restarts from the top of the
     * document, which on a long page is indistinguishable from the control
     * having done nothing at all.
     */
    expect(document.activeElement).toBe(opener)
  })

  it('cycles forward from the last control to the first', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }))

    await user.tab()
    // Not "Behind the dialog", which is what happens with no trap.
    expect(document.activeElement).toBe(screen.getByLabelText('First'))
  })

  it('cycles backward from the first control to the last', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }))
  })

  it('never lands on a control hidden from the accessibility tree', async () => {
    const user = userEvent.setup()
    render(<Harness withHoneypot />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    // Three Tabs around a two-control cycle returns to the start. If the
    // aria-hidden subtree were in the cycle, this would stop on it.
    await user.tab()
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }))
    expect(document.activeElement).not.toBe(screen.getByLabelText('Trap'))
  })
})

describe('closing', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on the backdrop but not on the panel', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    await user.click(screen.getByTestId('panel'))
    expect(screen.queryByRole('dialog')).not.toBeNull()

    await user.click(screen.getByTestId('panel').parentElement as HTMLElement)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('holds the page behind still while open, and lets it go after', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    // Restored to what it was, not hard-coded back to a value: a dialog
    // opened over an already-locked surface must not unlock it on close.
    expect(document.body.style.overflow).toBe('')
  })
})
