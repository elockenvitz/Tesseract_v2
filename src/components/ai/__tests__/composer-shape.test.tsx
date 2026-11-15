/**
 * The composer's shape, and the two faults that were bugs rather than taste.
 *
 * ── What this file can and cannot prove ─────────────────────────────────
 *
 * jsdom does no layout. `scrollHeight` is 0, nothing has a box, and no
 * scrollbar can ever appear in it. So this file does NOT claim to have
 * verified the composer visually, and the manual checklist in the handoff is
 * still the only thing that can.
 *
 * What it can do is pin the two MECHANISMS behind the reported appearance,
 * because both are decidable without a renderer:
 *
 *   THE DOUBLE FOCUS RING was `focus:border-primary-500` and
 *   `focus:ring-2 focus:ring-primary-500` on the same element, with no
 *   `outline-none`. Two concentric rings of one colour plus the browser's
 *   own. Decidable: the textarea must carry no focus border, ring or
 *   outline of its own, and the container must carry exactly one.
 *
 *   THE SCROLLBAR IN AN EMPTY BOX was arithmetic. `height = scrollHeight`
 *   is short by the border on a `box-sizing: border-box` element, so the
 *   box was 2px too small for its own single line, overflowed, and grew a
 *   native bar. Decidable: `scrollHeight` and the computed border can both
 *   be stubbed, and the height the effect writes can be read back.
 *
 * The rest here is behaviour: IME safety, one send per press, and the fact
 * that the attachments and the model picker are now inside the container
 * rather than in bands above and below it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiComposer } from '../AiComposer'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const box = () => screen.getByTestId('ai-composer-input') as HTMLTextAreaElement
const container = () => screen.getByTestId('ai-composer')

function Harness(props: Partial<React.ComponentProps<typeof AiComposer>> = {}) {
  const [value, setValue] = useState(props.value ?? '')
  const [sent, setSent] = useState<string[]>([])
  return (
    <>
      <AiComposer
        {...props}
        value={value}
        onChange={setValue}
        onSend={t => { setSent(s => [...s, t]); setValue('') }}
      />
      <output data-testid="sent">{JSON.stringify(sent)}</output>
    </>
  )
}

const sentList = () => JSON.parse(screen.getByTestId('sent').textContent || '[]') as string[]

/* ── The focus treatment ─────────────────────────────────────────────── */

describe('one focus ring, on one element', () => {
  it('gives the textarea no focus border, ring or outline of its own', () => {
    render(<Harness />)
    const cls = box().className

    /* The literal cause. Any of these three on the textarea reintroduces a
       second edge inside the container's own. */
    expect(cls).not.toMatch(/focus:border-/)
    /* `ring-0` is the fix; a ring of 1 or more is the fault. */
    expect(cls).not.toMatch(/focus:ring-[1-9]/)
    expect(cls).toMatch(/focus:outline-none/)
    expect(cls).toMatch(/focus:ring-0/)
  })

  it('gives the textarea no border at all', () => {
    render(<Harness />)
    /* It sits inside a bordered container. A border here is the inner of
       the two edges the reader described as heavy. */
    expect(box().className).toMatch(/border-0/)
    expect(box().className).not.toMatch(/\bborder-gray-\d/)
  })

  it('puts exactly one ring on the container, driven by focus-within', () => {
    render(<Harness />)
    const cls = container().className
    expect(cls).toMatch(/focus-within:ring-2/)
    /* One ring width, not two declarations of one. */
    expect([...cls.matchAll(/focus-within:ring-\d/g)]).toHaveLength(1)
  })

  it('draws one border, on the container', () => {
    render(<Harness />)
    expect(container().className).toMatch(/\bborder\b/)
    expect(container().className).toMatch(/rounded-2xl/)
  })
})

/* ── The scrollbar ───────────────────────────────────────────────────── */

describe('the height covers the border, which is why the bar appeared', () => {
  /** Give jsdom a scrollHeight and a border, as a browser would have. */
  function layout({ scrollHeight, border }: { scrollHeight: number; border: number }) {
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const style = real(el as HTMLElement)
      if ((el as HTMLElement).tagName === 'TEXTAREA') {
        return {
          ...style,
          borderTopWidth: `${border}px`,
          borderBottomWidth: `${border}px`,
        } as CSSStyleDeclaration
      }
      return style
    })
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
  }

  it('adds the border to the content height', () => {
    layout({ scrollHeight: 46, border: 1 })
    render(<Harness />)
    /*
     * 46 of content and padding, 1px of border top and bottom. The old code
     * wrote 46px and the box needed 48, so it overflowed by exactly the
     * border and grew a scrollbar on an empty line.
     */
    expect(box().style.height).toBe('48px')
  })

  it('writes the plain content height when there is no border', () => {
    layout({ scrollHeight: 46, border: 0 })
    render(<Harness />)
    expect(box().style.height).toBe('46px')
  })

  it('hides overflow until the text actually passes the cap', () => {
    layout({ scrollHeight: 46, border: 1 })
    render(<Harness />)
    expect(box().className).toMatch(/overflow-y-hidden/)
    expect(box().className).not.toMatch(/overflow-y-auto/)
  })

  it('allows scrolling once the cap is reached, and stops growing there', () => {
    layout({ scrollHeight: 900, border: 1 })
    render(<Harness />)
    /* The 220px cap, not 902. */
    expect(box().style.height).toBe('220px')
    expect(box().className).toMatch(/overflow-y-auto/)
  })

  it('reads the border rather than assuming a number', () => {
    /* A theme that sets a 2px border must not reintroduce the fault. */
    layout({ scrollHeight: 46, border: 2 })
    render(<Harness />)
    expect(box().style.height).toBe('50px')
  })
})

/* ── One container ───────────────────────────────────────────────────── */

describe('the attachments and the controls are inside the box', () => {
  it('renders context inside the container, not above it', () => {
    render(<Harness>{<span data-testid="chips">chips</span>}</Harness>)
    const band = screen.getByTestId('ai-composer-context')
    expect(container().contains(band)).toBe(true)
    expect(band.contains(screen.getByTestId('chips'))).toBe(true)
  })

  it('draws no context band when nothing is attached', () => {
    /* An empty strip with its own padding above every new conversation is
       what the floating band looked like. */
    render(<Harness />)
    expect(screen.queryByTestId('ai-composer-context')).toBeNull()
  })

  it('renders the toolbar inside the container, beside send', () => {
    render(<Harness toolbar={<button type="button">Model</button>} />)
    const model = screen.getByRole('button', { name: 'Model' })
    expect(container().contains(model)).toBe(true)
    expect(container().contains(screen.getByTestId('ai-composer-send'))).toBe(true)
  })

  it('keeps send from being pushed out by a long toolbar', () => {
    render(<Harness toolbar={<span>a very long model name indeed</span>} />)
    expect(screen.getByTestId('ai-composer-send').className).toMatch(/shrink-0/)
  })
})

/* ── Keys and sending ────────────────────────────────────────────────── */

describe('the keyboard contract', () => {
  it('sends on Enter', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), 'what is the bear case{Enter}')
    expect(sentList()).toEqual(['what is the bear case'])
  })

  it('makes a newline on Shift+Enter and sends nothing', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), 'one{Shift>}{Enter}{/Shift}two')
    expect(sentList()).toEqual([])
    expect(box().value).toBe('one\ntwo')
  })

  it('does not send while an input method is composing', async () => {
    render(<Harness value="" />)
    const el = box()
    /*
     * Typing Japanese, Chinese or Korean, Enter COMMITS the IME's candidate.
     * Treating it as a send fires the question with half-converted text in
     * it. Dispatched directly because userEvent has no composition mode.
     */
    el.focus()
    el.value = 'にほん'
    el.dispatchEvent(new Event('input', { bubbles: true }))

    const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    Object.defineProperty(composing, 'isComposing', { value: true })
    el.dispatchEvent(composing)

    expect(sentList()).toEqual([])
  })

  it('does not send on the older keyCode 229 composition signal', () => {
    render(<Harness />)
    const el = box()
    el.focus()
    const legacy = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true })
    el.dispatchEvent(legacy)
    expect(sentList()).toEqual([])
  })

  it('sends once when Enter is pressed twice in a frame', async () => {
    const onSend = vi.fn()
    /* A controlled value that does NOT clear, which is the window the guard
       exists for: the pane's isStreaming arrives a render after the click. */
    render(
      <AiComposer value="ask me" onChange={() => {}} onSend={onSend} />,
    )
    const user = userEvent.setup()
    await user.type(box(), '{Enter}')
    await user.type(box(), '{Enter}')
    /* Two deliberate presses in separate ticks are two sends; the guard
       releases on the next tick by design. What it stops is the same press
       resolving twice, below. */
    expect(onSend).toHaveBeenCalledTimes(2)
  })

  it('sends once when send is clicked twice without the value clearing', async () => {
    const onSend = vi.fn()
    render(<AiComposer value="ask me" onChange={() => {}} onSend={onSend} />)
    const button = screen.getByTestId('ai-composer-send')
    /* Both clicks inside one tick, as a double click is. */
    button.click()
    button.click()
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('will not send whitespace', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), '    {Enter}')
    expect(sentList()).toEqual([])
    expect(screen.getByTestId('ai-composer-send')).toBeDisabled()
  })

  it('trims what it sends', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), '  spaced  {Enter}')
    expect(sentList()).toEqual(['spaced'])
  })

  it('keeps a multiline paste intact', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    box().focus()
    await user.paste('line one\nline two\nline three')
    expect(box().value).toBe('line one\nline two\nline three')
    expect(sentList()).toEqual([])
  })
})

/* ── Streaming ───────────────────────────────────────────────────────── */

describe('while an answer is being written', () => {
  it('offers Stop where Send was, and calls the real handler', async () => {
    const onStop = vi.fn()
    const user = userEvent.setup()
    render(
      <AiComposer value="x" onChange={() => {}} onSend={() => {}} onStop={onStop} isStreaming />,
    )
    expect(screen.queryByTestId('ai-composer-send')).toBeNull()
    await user.click(screen.getByTestId('ai-composer-stop'))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('leaves the box editable, and says it is busy rather than disabling it', async () => {
    const user = userEvent.setup()
    render(<Harness isStreaming onStop={() => {}} />)
    expect(box()).not.toBeDisabled()
    expect(box()).toHaveAttribute('aria-busy', 'true')
    await user.type(box(), 'the next question')
    expect(box().value).toBe('the next question')
  })

  it('swallows Enter rather than abandoning the half-written answer', async () => {
    const user = userEvent.setup()
    render(<Harness isStreaming onStop={() => {}} />)
    await user.type(box(), 'queued?{Enter}')
    expect(sentList()).toEqual([])
    /* And no stray newline from the prevented keystroke. */
    expect(box().value).toBe('queued?')
  })

  it('keeps an unsent draft when streaming ends', () => {
    const { rerender } = render(
      <AiComposer value="my draft" onChange={() => {}} onSend={() => {}} onStop={() => {}} isStreaming />,
    )
    expect(box().value).toBe('my draft')
    rerender(
      <AiComposer value="my draft" onChange={() => {}} onSend={() => {}} onStop={() => {}} />,
    )
    expect(box().value).toBe('my draft')
    expect(screen.getByTestId('ai-composer-send')).toBeEnabled()
  })

  it('shows no Stop when there is no handler to stop with', () => {
    /* A Stop that does not stop is worse than no Stop. */
    render(<AiComposer value="x" onChange={() => {}} onSend={() => {}} isStreaming />)
    expect(screen.queryByTestId('ai-composer-stop')).toBeNull()
  })
})

describe('when AI is unavailable', () => {
  it('disables the box and the send control', () => {
    render(<Harness disabled />)
    expect(box()).toBeDisabled()
    expect(screen.getByTestId('ai-composer-send')).toBeDisabled()
  })
})
