/**
 * The composer: the box, the keys, and Send or Stop.
 *
 * Every case here is a press or a keystroke on the real component. The
 * component holds no conversation -- it takes a value and two handlers --
 * which is what makes "pressing Stop cancels the answer" observable without
 * standing up the hook, a network stream, or a database.
 *
 * The four faults the component replaces are named in its own header. These
 * are the cases that would fail if any of them came back.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AiComposer } from '../AiComposer'

afterEach(cleanup)

/**
 * The composer with real state behind it, as the pane wires it.
 *
 * A controlled component handed a frozen value cannot be typed into, and a
 * test that asserts on `onChange` calls proves the handler fired rather than
 * that the reader can write a question. This holds the value for real, so
 * typing, sending and clearing are all observable.
 */
function Harness({
  isStreaming = false,
  onStop,
  initial = '',
  disabled = false,
}: {
  isStreaming?: boolean
  onStop?: () => void
  initial?: string
  disabled?: boolean
}) {
  const [value, setValue] = useState(initial)
  const [sent, setSent] = useState<string[]>([])
  return (
    <>
      <AiComposer
        value={value}
        onChange={setValue}
        onSend={text => { setSent(s => [...s, text]); setValue('') }}
        onStop={onStop}
        isStreaming={isStreaming}
        disabled={disabled}
        placeholder="Ask anything"
      />
      <ul data-testid="sent">{sent.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </>
  )
}

const box = () => screen.getByTestId('ai-composer-input') as HTMLTextAreaElement
const sent = () => [...screen.getByTestId('sent').querySelectorAll('li')].map(li => li.textContent)

/* ------------------------------------------------------------------ sending */

describe('sending a question', () => {
  it('sends on Enter and clears the box', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(box(), 'What is the bear case?')
    await user.keyboard('{Enter}')

    expect(sent()).toEqual(['What is the bear case?'])
    expect(box().value).toBe('')
  })

  it('sends the trimmed text, not what the box happened to hold', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(box(), '   spaced   ')
    await user.keyboard('{Enter}')

    expect(sent()).toEqual(['spaced'])
  })

  it('takes a newline on Shift+Enter instead of sending', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(box(), 'First line')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    await user.type(box(), 'Second line')

    expect(sent()).toEqual([])
    expect(box().value).toBe('First line\nSecond line')
  })

  it('sends on Cmd or Ctrl+Enter too', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(box(), 'Habit from every other composer')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(sent()).toEqual(['Habit from every other composer'])
  })

  it('refuses to send nothing', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(box(), '    ')
    await user.keyboard('{Enter}')
    expect(sent()).toEqual([])

    /* And the control says so rather than looking pressable. */
    expect(screen.getByTestId('ai-composer-send')).toBeDisabled()
  })

  it('sends on the button as well as the key', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(box(), 'By button')
    await user.click(screen.getByTestId('ai-composer-send'))

    expect(sent()).toEqual(['By button'])
  })
})

/* ----------------------------------------------------------------- stopping */

describe('stopping an answer that is being written', () => {
  it('shows Stop in place of Send for the whole generation', () => {
    render(<Harness isStreaming onStop={vi.fn()} />)

    expect(screen.getByTestId('ai-composer-stop')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-composer-send')).toBeNull()
  })

  it('calls the real cancellation handler when pressed', async () => {
    const user = userEvent.setup()
    const stop = vi.fn()
    render(<Harness isStreaming onStop={stop} />)

    await user.click(screen.getByTestId('ai-composer-stop'))

    /*
     * The decorative-Stop case. A control that looks like Stop and reaches
     * nothing is the thing this must never be, so the handler is asserted as
     * CALLED rather than the button asserted as present.
     */
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('names the control, so it is not an unlabelled square', () => {
    render(<Harness isStreaming onStop={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Stop generating' })).toBeInTheDocument()
  })

  it('falls back to Send when there is nothing able to stop', () => {
    /*
     * No handler, so no Stop. A streaming flag alone does not earn the
     * control: the component will not draw a Stop it cannot honour.
     */
    render(<Harness isStreaming />)
    expect(screen.queryByTestId('ai-composer-stop')).toBeNull()
    expect(screen.getByTestId('ai-composer-send')).toBeDisabled()
  })
})

/* ------------------------------------------------- typing while it streams */

describe('the reader keeps the box while an answer streams', () => {
  it('stays typeable, and keeps what was typed', async () => {
    const user = userEvent.setup()
    render(<Harness isStreaming onStop={vi.fn()} />)

    expect(box()).not.toBeDisabled()
    await user.type(box(), 'The next question, written while it answers')
    expect(box().value).toBe('The next question, written while it answers')
  })

  it('does not send on Enter mid-answer, and does not drop a newline either', async () => {
    const user = userEvent.setup()
    render(<Harness isStreaming onStop={vi.fn()} initial="Half typed" />)

    await user.click(box())
    await user.keyboard('{Enter}')

    /*
     * Enter is swallowed. Sending would abandon the answer being written,
     * which a keystroke is not a clear instruction to do; a newline would be
     * a character the reader did not ask for.
     */
    expect(sent()).toEqual([])
    expect(box().value).toBe('Half typed')
  })

  it('says it is busy without going dead', () => {
    render(<Harness isStreaming onStop={vi.fn()} />)
    expect(box()).toHaveAttribute('aria-busy', 'true')
    expect(box()).not.toBeDisabled()
  })
})

/* ------------------------------------------------------------------ height */

describe('the box is the size of the question', () => {
  /*
   * jsdom lays nothing out, so `scrollHeight` is 0 and the measured height
   * is not observable here. What IS observable is that the component sets
   * the height from the VALUE rather than from the keystroke -- the fault
   * that left a seeded prompt in a one-row box with its own scrollbar.
   */
  it('sizes a value it was handed, not only one that was typed', () => {
    render(<Harness initial={'One\nTwo\nThree\nFour'} />)
    /* Written by the layout effect, so it is already set on the first frame
       rather than after one frame of a one-row box. The measurement itself is
       0 under jsdom; that an explicit pixel height was computed AT ALL from a
       value nobody typed is the fault that was there. */
    expect(box().style.height).toMatch(/px$/)
  })

  it('caps the height rather than growing without limit', () => {
    render(<Harness initial={'line\n'.repeat(200)} />)
    const height = Number.parseInt(box().style.height, 10)
    expect(Number.isNaN(height)).toBe(false)
    /* jsdom reports scrollHeight 0, so this cannot assert the cap was
       reached. It can assert the cap is never exceeded, which is the half
       that holds under any layout. */
    expect(height).toBeLessThanOrEqual(220)
  })
})

/* ---------------------------------------------------------------- disabled */

describe('when the pane cannot send at all', () => {
  it('blocks the box and the control together', async () => {
    const user = userEvent.setup()
    render(<Harness disabled initial="Typed before it was blocked" />)

    expect(box()).toBeDisabled()
    expect(screen.getByTestId('ai-composer-send')).toBeDisabled()

    await user.click(screen.getByTestId('ai-composer-send'))
    expect(sent()).toEqual([])
  })
})
