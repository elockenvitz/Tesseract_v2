/**
 * The briefing renders through the pane's components, and nothing before it is
 * asked for.
 *
 * ── The two things worth asserting ───────────────────────────────────────
 *
 * First: no second renderer. A briefing with its own account of a failed
 * lookup would eventually say "no records found" where the pane says "this
 * lookup failed", and that divergence is the whole reason the presentation
 * layer was extracted. So these assert the briefing produces the pane's own
 * sentences, by comparing against the shared words rather than hard-coding
 * them twice.
 *
 * Second: it costs money and seconds, so nothing runs on a page open. The
 * reader is told what the briefing will do and presses once.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiBriefing } from '../AiBriefing'
import { BRIEFING_TITLE, BRIEFING_INTENT } from '../../../lib/ai/briefing'
import { ACT_AI_BRIEFING } from '../../../lib/ai/brand'
import { emptySentence, toolCallOutcome } from '../../../lib/ai/trail-text'
import type { AiRenderableMessage, MessageToolCall } from '../../../lib/ai/presentation'

const answer = (over: Partial<AiRenderableMessage> = {}): AiRenderableMessage => ({
  id: 'briefing:a1:decision',
  role: 'assistant',
  content: 'A buy is waiting in Core Growth. The thesis supports it; the rating does not.',
  timestamp: new Date('2026-11-11T12:00:00Z'),
  ...over,
})

const lookup = (over: Partial<MessageToolCall> = {}): MessageToolCall => ({
  name: 'get_decisions',
  input: { symbol: 'AAPL' },
  status: 'ok',
  scope: 'caller_visible',
  result_count: 2,
  sources: [{
    kind: 'decision_request', id: 'dr1', asset_id: 'a1', symbol: 'AAPL',
    title: 'AAPL PM ruling: pending', timestamp: '2026-11-01T00:00:00Z',
  }],
  ...over,
})

/** Everything off: nothing fetched, nothing answered, nothing failed. */
const idle = {
  context: 'review' as const,
  message: null,
  toolCalls: [],
  isLoading: false,
  error: null,
}

describe('nothing runs until the reader asks', () => {
  it('offers a control and no answer on a fresh page', () => {
    render(<AiBriefing {...idle} onRun={() => {}} />)
    expect(screen.getByTestId('ai-briefing-run')).toBeTruthy()
    expect(screen.queryByTestId('ai-thinking')).toBeNull()
    expect(screen.queryByTestId('ai-research-trail')).toBeNull()
  })

  it('says what the briefing will do before it is paid for', () => {
    /* A bare "Generate" does not tell a reader what several seconds buys. */
    render(<AiBriefing {...idle} context="decision" onRun={() => {}} />)
    expect(screen.getByTestId('ai-briefing-context').textContent).toBe(BRIEFING_TITLE.decision)
    expect(screen.getByText(new RegExp(BRIEFING_INTENT.decision.slice(0, 30)))).toBeTruthy()
  })

  it('runs once, on the press', async () => {
    const onRun = vi.fn()
    render(<AiBriefing {...idle} onRun={onRun} />)
    await userEvent.click(screen.getByTestId('ai-briefing-run'))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('names the assistant the way the rest of the product does', () => {
    render(<AiBriefing {...idle} onRun={() => {}} />)
    expect(screen.getByText(ACT_AI_BRIEFING)).toBeTruthy()
    expect(screen.queryByText(/Co-?Analyst/i)).toBeNull()
  })

  it('keeps the frame visible while it works, so the pane does not go blank', () => {
    render(<AiBriefing {...idle} isLoading onRun={() => {}} />)
    expect(screen.getByTestId('ai-thinking')).toBeTruthy()
    expect(screen.getByTestId('ai-briefing-context')).toBeTruthy()
    expect(screen.queryByTestId('ai-briefing-run')).toBeNull()
  })
})

describe('one presentation layer, not two', () => {
  it('shows what it consulted, open, without being asked', () => {
    /*
     * Opposite to the chat pane on purpose. In a conversation the trail is
     * something to check when an answer surprises you; a briefing is read
     * once in place of doing the reading, so its sources are part of the
     * artifact.
     */
    render(
      <AiBriefing {...idle} context="decision" message={answer()} toolCalls={[lookup()]} onRun={() => {}} />,
    )
    expect(screen.getByText('AAPL PM ruling: pending')).toBeTruthy()
    /*
     * The RECORD, open, and the provenance with it -- not the lookup's label.
     *
     * This test used to assert "Checked the decision record for AAPL", the
     * name of the function call. Leading with the machine's actions is what
     * made the old trail read as diagnostics, so a lookup's label now appears
     * only when it says something the record list does not: that it failed,
     * or that nothing was found. The number of lookups is still stated, so
     * nothing about provenance is hidden.
     */
    expect(screen.getByText('From 1 lookup')).toBeTruthy()
    expect(screen.getByTestId('ai-evidence-relation')).toBeTruthy()
  })

  it('reports a lookup s reach in the pane s own words, not its own', () => {
    /* Compared against the shared function rather than a literal, so the two
       surfaces cannot be reworded apart. */
    render(
      <AiBriefing
        {...idle}
        message={answer()}
        toolCalls={[lookup({ status: 'empty', result_count: 0, sources: [], searched: 'AAPL in your inbox' })]}
        onRun={() => {}}
      />,
    )
    const expected = emptySentence('AAPL in your inbox', 'caller_visible')
    expect(screen.getByText(expected)).toBeTruthy()
    /* And it is not the sentence that claims something about the firm. */
    expect(screen.queryByText('No matching records.')).toBeNull()
  })

  it('says a failed lookup failed, here as there', () => {
    render(
      <AiBriefing
        {...idle}
        message={answer()}
        toolCalls={[lookup({ status: 'error', result_count: 0, sources: [] })]}
        onRun={() => {}}
      />,
    )
    const failed = toolCallOutcome({ name: 'get_decisions', input: {}, status: 'error' })
    expect(screen.getByText(failed.text)).toBeTruthy()
    expect(screen.queryByText(/no matching records/i)).toBeNull()
  })

  it('renders the prose as markdown rather than as a string', () => {
    const { container } = render(
      <AiBriefing {...idle} message={answer({ content: 'The **thesis** supports it.' })} toolCalls={[]} onRun={() => {}} />,
    )
    expect(container.querySelector('strong')?.textContent).toBe('thesis')
  })

  it('offers no trail when there was nothing to consult', () => {
    render(<AiBriefing {...idle} message={answer()} toolCalls={[]} onRun={() => {}} />)
    expect(screen.queryByText(/^Research \(/)).toBeNull()
  })
})

describe('when it fails', () => {
  it('offers the way back, and never an answer', () => {
    const onRetry = vi.fn()
    render(
      <AiBriefing {...idle} error={new Error('The provider is unreachable.')} onRun={() => {}} onRetry={onRetry} />,
    )
    expect(screen.getByTestId('ai-error')).toBeTruthy()
    expect(screen.getByText('The provider is unreachable.')).toBeTruthy()
    expect(screen.queryByTestId('ai-briefing-run')).toBeNull()
  })

  it('falls back to the run handler when no retry was given', async () => {
    const onRun = vi.fn()
    render(<AiBriefing {...idle} error={new Error('nope')} onRun={onRun} />)
    await userEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('shows the error rather than a stale answer beside it', () => {
    /* A failed refresh must not leave the previous briefing on screen looking
       current. The error wins. */
    render(
      <AiBriefing {...idle} message={answer()} error={new Error('nope')} onRun={() => {}} />,
    )
    expect(screen.getByTestId('ai-error')).toBeTruthy()
    expect(screen.queryByText(/The thesis supports it/)).toBeNull()
  })
})

describe('carrying it into the pane', () => {
  it('offers the handoff only once there is a briefing to continue from', () => {
    const onContinue = vi.fn()
    const { rerender } = render(
      <AiBriefing {...idle} onRun={() => {}} onContinueInChat={onContinue} />,
    )
    expect(screen.queryByTestId('ai-briefing-continue')).toBeNull()

    rerender(
      <AiBriefing {...idle} message={answer()} toolCalls={[]} onRun={() => {}} onContinueInChat={onContinue} />,
    )
    expect(screen.getByTestId('ai-briefing-continue')).toBeTruthy()
  })

  it('hides the handoff entirely where the surface cannot honour it', () => {
    /* A control that looks pressable and does nothing is worse than no
       control, which is the rule the prompt buttons follow too. */
    render(<AiBriefing {...idle} message={answer()} toolCalls={[]} onRun={() => {}} />)
    expect(screen.queryByTestId('ai-briefing-continue')).toBeNull()
  })

  it('hands over on the press', async () => {
    const onContinue = vi.fn()
    render(
      <AiBriefing {...idle} message={answer()} toolCalls={[]} onRun={() => {}} onContinueInChat={onContinue} />,
    )
    await userEvent.click(screen.getByTestId('ai-briefing-continue'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})

describe('which situation it says it is in', () => {
  it('carries the context as data, so a surface can act on it', () => {
    const { container } = render(<AiBriefing {...idle} context="decision" onRun={() => {}} />)
    expect(container.querySelector('[data-briefing-context="decision"]')).toBeTruthy()
  })

  it('shows the review framing when nothing is waiting', () => {
    render(<AiBriefing {...idle} context="review" onRun={() => {}} />)
    expect(screen.getByTestId('ai-briefing-context').textContent).toBe(BRIEFING_TITLE.review)
  })
})
