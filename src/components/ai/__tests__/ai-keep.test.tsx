/**
 * The control that keeps an answer, and the two things it must not do.
 *
 * It must not save anything, and it must not open anything without first
 * telling the reader that a model wrote the text. Both are asserted on real
 * behaviour: the test listens on the capture channel the shell listens on, so
 * "nothing happened yet" is an observation rather than an assumption.
 *
 * Nothing is mocked. The component reaches no database and no store -- it
 * dispatches one window event -- which is the property that makes a promotion
 * reviewable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiKeep } from '../AiKeep'
import { CAPTURE_OPEN_EVENT, readCaptureOpen, type CaptureOpenRequest } from '../../../lib/capture/prefill'

const answer = {
  role: 'assistant' as const,
  content: 'The mark is 11% through the March target.',
  streaming: false,
}

let requests: CaptureOpenRequest[] = []
const listener = (event: Event) => {
  const request = readCaptureOpen((event as CustomEvent).detail)
  if (request) requests.push(request)
}

beforeEach(() => {
  requests = []
  window.addEventListener(CAPTURE_OPEN_EVENT, listener)
})

afterEach(() => {
  window.removeEventListener(CAPTURE_OPEN_EVENT, listener)
  cleanup()
})

const keep = (props: Partial<React.ComponentProps<typeof AiKeep>> = {}) =>
  render(
    <AiKeep
      message={answer}
      conversationTitle="AAPL decisions"
      subject={{ type: 'asset', id: 'a-aapl', label: 'AAPL' }}
      {...props}
    />,
  )

/** Render, then go through the menu to the dialog, which is where every
    promotion goes. */
async function choose(id: string, props: Partial<React.ComponentProps<typeof AiKeep>> = {}) {
  keep(props)
  const user = userEvent.setup()
  await user.click(screen.getByTestId('ai-keep'))
  await user.click(screen.getByTestId('ai-keep-menu').querySelector(`[data-promotion="${id}"]`)!)
  return user
}

describe('when it appears', () => {
  it('offers the three kinds the form can store', async () => {
    keep()
    await userEvent.click(screen.getByTestId('ai-keep'))
    const options = screen.getByTestId('ai-keep-menu').querySelectorAll('[data-slot="ai-keep-option"]')
    expect(Array.from(options).map(o => o.getAttribute('data-promotion')))
      .toEqual(['thought', 'research_idea', 'thesis'])
  })

  it('is not there while the answer is still arriving', () => {
    keep({ message: { ...answer, streaming: true } })
    expect(screen.queryByTestId('ai-keep')).toBeNull()
  })

  it('is not there for an empty answer or for the readers own turn', () => {
    keep({ message: { ...answer, content: '  ' } })
    expect(screen.queryByTestId('ai-keep')).toBeNull()
    cleanup()
    keep({ message: { ...answer, role: 'user' } })
    expect(screen.queryByTestId('ai-keep')).toBeNull()
  })
})

describe('before anything opens', () => {
  it('asks, and dispatches nothing while it is asking', async () => {
    await choose('thought')
    /* The dialog is up. Nothing has been sent, so a reader who changes their
       mind has changed nothing. */
    expect(requests).toHaveLength(0)
    expect(screen.getByText('Keep as a quick thought')).toBeTruthy()
  })

  it('says a model wrote it, and that it is not a decision record', async () => {
    await choose('thesis')
    const dialog = screen.getByText(/ACT AI wrote it/).closest('div')!
    expect(dialog.textContent).toContain('not a decision or an audit record')
    expect(dialog.textContent).toContain('Nothing is saved until you save it')
  })

  it('names the asset it will be filed against', async () => {
    await choose('research_idea')
    expect(screen.getByText(/filed against AAPL/)).toBeTruthy()
  })

  it('sends nothing at all when the reader cancels', async () => {
    const user = await choose('thought')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(requests).toHaveLength(0)
    // And the dialog is gone rather than merely hidden behind the menu.
    expect(screen.queryByText(/ACT AI wrote it/)).toBeNull()
  })
})

describe('on confirmation', () => {
  it('opens the capture form with the answer and its provenance', async () => {
    const user = await choose('research_idea')
    await user.click(screen.getByRole('button', { name: 'Open the draft' }))

    expect(requests).toHaveLength(1)
    const request = requests[0]
    expect(request.captureType).toBe('idea')
    expect(request.prefill).toEqual({
      text: answer.content,
      ideaType: 'research_idea',
      sourceTitle: 'ACT AI answer, AAPL decisions',
      assetId: 'a-aapl',
    })
  })

  it('tells the host what was kept', async () => {
    const onPromoted = vi.fn()
    render(
      <AiKeep message={answer} conversationTitle="AAPL decisions" onPromoted={onPromoted} />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByTestId('ai-keep'))
    await user.click(screen.getByTestId('ai-keep-menu').querySelector('[data-promotion="thesis"]')!)
    await user.click(screen.getByRole('button', { name: 'Open the draft' }))
    expect(onPromoted).toHaveBeenCalledWith('thesis')
  })

  it('sends one request per confirmation, not one per press of the menu', async () => {
    const user = await choose('thought')
    await user.click(screen.getByRole('button', { name: 'Open the draft' }))
    expect(requests).toHaveLength(1)
    /* The dialog closes with the send, so a second confirmation needs a
       second choice. A promotion that could be double-fired would open two
       drafts of the same paragraph. */
    expect(screen.queryByRole('button', { name: 'Open the draft' })).toBeNull()
  })
})

describe('the menu', () => {
  it('closes on Escape without keeping anything', async () => {
    const user = userEvent.setup()
    keep()
    await user.click(screen.getByTestId('ai-keep'))
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('ai-keep-menu')).toBeNull()
    expect(requests).toHaveLength(0)
  })
})

describe('what it never does', () => {
  it('reaches no table: the only thing it emits is the capture request', async () => {
    /* The guard against this control growing a write of its own. If a future
       change saved a record here, the promotion would be a model's paragraph
       stored in a reader's name without the form they were promised. */
    const user = await choose('thought')
    const seen: string[] = []
    const spy = (event: Event) => seen.push(event.type)
    for (const type of ['openThoughtsCapture', 'decision-engine-action', 'open-asset', 'engagement:discuss']) {
      window.addEventListener(type, spy)
    }
    await user.click(screen.getByRole('button', { name: 'Open the draft' }))
    for (const type of ['openThoughtsCapture', 'decision-engine-action', 'open-asset', 'engagement:discuss']) {
      window.removeEventListener(type, spy)
    }
    expect(seen).toEqual(['openThoughtsCapture'])
  })
})

describe('unopened', () => {
  it('shows no dialog and no menu until it is pressed', () => {
    const view = keep()
    expect(screen.queryByTestId('ai-keep-menu')).toBeNull()
    expect(within(view.container).queryByText(/ACT AI wrote it/)).toBeNull()
  })
})
