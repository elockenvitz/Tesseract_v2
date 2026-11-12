/**
 * The message shell and the three non-answer states.
 *
 * Two of these assert something the panel did not do before: a stream that
 * died halfway said nothing about it, and a failed turn offered no way back
 * even though the hook had already popped the text out of the thread.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AiMessage } from '../AiMessage'
import { AiThinking, AiErrorNotice, AiPrompts } from '../AiStates'
import type { AiRenderableMessage } from '../../../lib/ai/presentation'

const msg = (over: Partial<AiRenderableMessage> = {}): AiRenderableMessage => ({
  id: 'm1', role: 'assistant', content: 'The PM ruling is pending.',
  timestamp: new Date('2026-04-12T15:04:00Z'), ...over,
})

describe('AiMessage', () => {
  it('renders assistant prose through the markdown renderer', () => {
    const { container } = render(<AiMessage message={msg({ content: '**bold**' })} />)
    expect(container.querySelector('strong')?.textContent).toBe('bold')
  })

  it('renders a user turn as plain text, never as markdown', () => {
    const { container } = render(
      <AiMessage message={msg({ role: 'user', content: '**not bold**' })} />,
    )
    expect(container.querySelector('strong')).toBeNull()
    expect(screen.getByText('**not bold**')).toBeTruthy()
  })

  it('shows the model label the caller resolved', () => {
    render(<AiMessage message={msg({ model: 'claude-sonnet-4-6' })} modelLabel="Claude Sonnet 4.6" />)
    expect(screen.getByText('Claude Sonnet 4.6')).toBeTruthy()
  })

  it('says a truncated answer is incomplete', () => {
    /* A dropped stream used to be silent: the reader got a half answer with
       nothing marking it as one. */
    render(<AiMessage message={msg({ truncated: true })} />)
    expect(screen.getByText('Incomplete')).toBeTruthy()
  })

  it('offers no Copy while the answer is still arriving', () => {
    render(<AiMessage message={msg({ streaming: true, content: 'The PM ruling' })} />)
    expect(screen.queryByTitle('Copy response')).toBeNull()
  })

  it('offers Copy once the answer is complete', () => {
    render(<AiMessage message={msg()} />)
    expect(screen.getByTitle('Copy response')).toBeTruthy()
  })

  it('renders the footer slot for an assistant turn only', () => {
    const footer = <div data-testid="actions">actions</div>
    render(<AiMessage message={msg()} footer={footer} />)
    expect(screen.getByTestId('actions')).toBeTruthy()

    render(<AiMessage message={msg({ role: 'user', id: 'm2' })} footer={footer} />)
    expect(screen.getAllByTestId('actions')).toHaveLength(1)
  })
})

describe('AiThinking', () => {
  it('shows the grounded activity from the stream', () => {
    render(<AiThinking status="Checking the decision record…" />)
    expect(screen.getByText('Checking the decision record…')).toBeTruthy()
  })

  it('falls back to a neutral word with no status', () => {
    render(<AiThinking />)
    expect(screen.getByText('Working…')).toBeTruthy()
  })

  it('offers Stop only when there is something to stop', async () => {
    const onStop = vi.fn()
    render(<AiThinking status="Working…" onStop={onStop} />)
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })

  it('omits Stop with no handler', () => {
    render(<AiThinking status="Working…" />)
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })
})

describe('AiErrorNotice', () => {
  it('renders nothing without an error', () => {
    const { container } = render(<AiErrorNotice error={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the message and a way back', async () => {
    const onRetry = vi.fn()
    render(<AiErrorNotice error={new Error('Rate limit reached')} onRetry={onRetry} />)

    expect(screen.getByText('Rate limit reached')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('offers no Retry when the caller cannot honour one', () => {
    /* A Retry that sends something else, or nothing, is worse than none. */
    render(<AiErrorNotice error={new Error('boom')} />)
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull()
  })

  it('still says something when the error carries no message', () => {
    render(<AiErrorNotice error={new Error('')} />)
    expect(screen.getByText('Try again, or rephrase your question.')).toBeTruthy()
  })
})

describe('AiPrompts', () => {
  it('sends the prompt the reader picked', async () => {
    const onPick = vi.fn()
    render(<AiPrompts suggestions={['What are the key risks?', 'Summarise the notes']} onPick={onPick} />)

    await userEvent.click(screen.getByRole('button', { name: 'What are the key risks?' }))
    expect(onPick).toHaveBeenCalledWith('What are the key risks?')
  })

  it('shows a header above the prompts when given one', () => {
    render(
      <AiPrompts
        suggestions={['a']}
        onPick={() => {}}
        header={<AiErrorNotice error={new Error('popped')} />}
      />,
    )
    expect(screen.getByText('popped')).toBeTruthy()
  })

  /*
   * Grounded prompts arrive as `{ text, reason }` rather than a string, and
   * the reason is the whole point: it is the records that justify offering
   * the question. These assert the reader can see it, that it never stands in
   * for the question, and that a prompt with no record behind it says nothing.
   */
  it('shows why a question is being offered, under the question', () => {
    render(
      <AiPrompts
        suggestions={[{ text: 'What needs a decision?', reason: '4 are waiting, the longest for 9 days' }]}
        onPick={() => {}}
      />,
    )
    const reason = screen.getByTestId('ai-prompt-reason')
    expect(reason.textContent).toBe('4 are waiting, the longest for 9 days')
    /* Inside the button, so it reads as one thing, not a caption beside it. */
    expect(reason.closest('button')).toBeTruthy()
  })

  it('still sends only the question when a reason is attached', () => {
    const onPick = vi.fn()
    render(
      <AiPrompts
        suggestions={[{ text: 'What needs a decision?', reason: '4 are waiting' }]}
        onPick={onPick}
      />,
    )
    /* The accessible name covers both lines, so match on the question alone. */
    screen.getByRole('button', { name: /What needs a decision\?/ }).click()
    expect(onPick).toHaveBeenCalledWith('What needs a decision?')
    expect(onPick).not.toHaveBeenCalledWith(expect.stringContaining('waiting'))
  })

  it('renders no reason line for a prompt that has no record behind it', () => {
    render(
      <AiPrompts
        suggestions={[{ text: 'What is in my Idea Pipeline?', reason: null }, 'Which names am I covering?']}
        onPick={() => {}}
      />,
    )
    expect(screen.queryByTestId('ai-prompt-reason')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('accepts plain strings and grounded prompts in one list', () => {
    render(
      <AiPrompts
        suggestions={['Analyze AAPL for blind spots', { text: 'What is overdue?', reason: '2 past due' }]}
        onPick={() => {}}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getAllByTestId('ai-prompt-reason')).toHaveLength(1)
  })

  it('keeps a reason legible rather than clipping it', () => {
    /* A fixed 56px height cut the second line off. The floor is a floor. */
    render(
      <AiPrompts
        suggestions={[{ text: 'What needs a decision?', reason: '4 are waiting' }]}
        onPick={() => {}}
      />,
    )
    const cls = screen.getAllByRole('button')[0].className
    expect(cls).toContain('min-h-[56px]')
    /* The lookbehind is load-bearing: `min-h-[56px]` ends in `h-[56px]`, so
       without it this assertion fails against the correct class list. */
    expect(cls).not.toMatch(/(?<!min-)\bh-(14|\[56px\])\b/)
  })

  it('gives the reason room and a readable size', () => {
    /*
     * These were reported as cramped by a reader looking at the real panel,
     * which is the only way this class of problem gets found. The numbers
     * here are floors, not the design: the reason used to be 10.5px sitting
     * 2px under the question, and a fractional font size under 11px is the
     * specific thing that read as unreadable.
     */
    render(
      <AiPrompts
        suggestions={[{ text: 'What needs a decision?', reason: '4 in your decision inbox' }]}
        onPick={() => {}}
      />,
    )
    const cls = screen.getAllByRole('button')[0].className
    /* Not `gap-0.5`, which put the two lines 2px apart. */
    expect(cls).not.toMatch(/\bgap-0(\.5)?\b/)
    expect(cls).toMatch(/\bgap-1\b/)

    const reason = screen.getByTestId('ai-prompt-reason').className
    const px = Number(reason.match(/text-\[([\d.]+)px\]/)?.[1] ?? NaN)
    expect(px, `reason font size from "${reason}"`).toBeGreaterThanOrEqual(11)
    /* And it is distinguishable from its own background in the dark theme,
       where it was `gray-500` text on a `gray-800` panel. */
    expect(reason).not.toMatch(/dark:text-gray-5\d\d/)
  })

  it('separates the questions from each other', () => {
    /* A 8px gutter between two-line buttons read as one block of grey. */
    render(
      <AiPrompts suggestions={['One?', 'Two?', 'Three?']} onPick={() => {}} />,
    )
    const list = screen.getByTestId('ai-prompts').className
    expect(list).toMatch(/space-y-2\.5|gap-2\.5/)
  })
})

/*
 * The point of the extraction.
 *
 * AISection must not keep private copies of these: two implementations of the
 * three-status rule is how "the lookup failed" starts rendering as "no records
 * found" on one surface and not the other. Asserted on the source because the
 * component cannot be imported without a live Supabase client, auth and an org
 * context — which is the very reason these pieces were trapped in it.
 */
describe('AISection holds no second copy', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/components/communication/AISection.tsx'), 'utf8',
  )

  it('declares none of the extracted components itself', () => {
    for (const gone of [
      'function ToolCallsFooter', 'function SourceLink',
      'function CitationsFooter', 'function AIMessageBubble',
    ]) {
      expect(SRC, gone).not.toContain(gone)
    }
  })

  it('does not re-implement the outcome sentences', () => {
    expect(SRC).not.toContain('This lookup failed')
    expect(SRC).not.toContain('No matching records')
  })

  it('renders through the shared layer', () => {
    expect(SRC).toMatch(/from '\.\.\/ai'/)
    expect(SRC).toMatch(/<AiMessage/)
    expect(SRC).toMatch(/<AiThinking/)
    expect(SRC).toMatch(/<AiErrorNotice/)
    expect(SRC).toMatch(/<AiPrompts/)
  })
})
