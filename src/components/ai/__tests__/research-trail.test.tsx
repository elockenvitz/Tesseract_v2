/**
 * The trail, and the one rule it carries.
 *
 * `empty` and `error` are different facts. "We looked and found none" and "we
 * could not look" must never render the same way, because conflating them is
 * how a reader is told the firm holds no research on a name when the query
 * simply fell over. That rule previously lived in a module-local function
 * inside AISection where nothing could test it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResearchTrail, SourceRef } from '../ResearchTrail'
import { SOURCE_KIND_LABEL, toolCallOutcome, toolCallLabel } from '../../../lib/ai/trail-text'
import type { AiSourceRef, MessageToolCall } from '../../../lib/ai/presentation'

const call = (over: Partial<MessageToolCall> = {}): MessageToolCall => ({
  name: 'get_decisions', input: { symbol: 'AAPL' }, ...over,
})

const source = (over: Partial<AiSourceRef> = {}): AiSourceRef => ({
  kind: 'decision_request', id: 'dr-1', asset_id: 'a-1', symbol: 'AAPL',
  title: 'AAPL PM ruling: pending', timestamp: '2026-04-12T00:00:00Z', ...over,
})

describe('the three statuses read differently', () => {
  it('says how many records an ok lookup found', () => {
    expect(toolCallOutcome(call({ status: 'ok', result_count: 8 })).text).toBe('8 records found.')
    expect(toolCallOutcome(call({ status: 'ok', result_count: 1 })).text).toBe('1 record found.')
  })

  it('names what was searched when nothing matched', () => {
    expect(toolCallOutcome(call({ status: 'empty', searched: 'AAPL in team notes' })).text)
      .toBe('No matches for AAPL in team notes.')
  })

  it('says the lookup FAILED, and never that nothing was found', () => {
    const o = toolCallOutcome(call({ status: 'error' }))
    expect(o.text).toBe('This lookup failed, so the answer may be incomplete.')
    expect(o.text).not.toMatch(/no match/i)
    expect(o.text).not.toMatch(/not found/i)
  })

  it('gives empty and error different words AND different tones', () => {
    const empty = toolCallOutcome(call({ status: 'empty' }))
    const failed = toolCallOutcome(call({ status: 'error' }))
    expect(empty.text).not.toBe(failed.text)
    expect(empty.tone).not.toBe(failed.tone)
  })

  it('invents no outcome for a message older than the status field', () => {
    expect(toolCallOutcome(call({})).text).toBe('')
  })
})

describe('tool labels', () => {
  it('names each lookup in plain words', () => {
    expect(toolCallLabel('get_decisions', { symbol: 'aapl' })).toBe('Checked the decision record for AAPL')
    expect(toolCallLabel('get_workflows', { symbol: 'aapl' })).toBe('Checked open work on AAPL')
    expect(toolCallLabel('search_team_notes', { query: 'china' })).toBe('Searched notes for "china"')
  })

  it('falls back to the raw name for a tool it does not know', () => {
    expect(toolCallLabel('get_future_thing', {})).toBe('get_future_thing')
  })
})

describe('ResearchTrail', () => {
  it('renders nothing at all with no lookups', () => {
    const { container } = render(<ResearchTrail toolCalls={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('is folded away by default and opens on press', async () => {
    render(<ResearchTrail toolCalls={[call({ status: 'ok', result_count: 2, sources: [source()] })]} />)

    expect(screen.queryByText('AAPL PM ruling: pending')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Research \(1\)/ }))
    expect(screen.getByText('AAPL PM ruling: pending')).toBeTruthy()
  })

  it('opens already expanded for a briefing', () => {
    render(
      <ResearchTrail
        defaultOpen
        toolCalls={[call({ status: 'ok', result_count: 1, sources: [source()] })]}
      />,
    )
    expect(screen.getByText('AAPL PM ruling: pending')).toBeTruthy()
  })

  it('warns on the summary line when any lookup failed', () => {
    render(<ResearchTrail toolCalls={[call({ status: 'ok' }), call({ name: 'get_workflows', status: 'error' })]} />)
    expect(screen.getByTitle('A lookup failed')).toBeTruthy()
  })

  it('does not warn when every lookup ran', () => {
    render(<ResearchTrail toolCalls={[call({ status: 'ok' }), call({ status: 'empty' })]} />)
    expect(screen.queryByTitle('A lookup failed')).toBeNull()
  })
})

describe('SourceRef', () => {
  const dispatched: CustomEvent[] = []
  const capture = (e: Event) => { dispatched.push(e as CustomEvent) }

  beforeEach(() => {
    dispatched.length = 0
    window.addEventListener('tesseract:open-asset', capture)
  })
  afterEach(() => {
    window.removeEventListener('tesseract:open-asset', capture)
  })

  it('keeps the four decision records four different words', () => {
    expect(SOURCE_KIND_LABEL.recommendation).toBe('Recommendation')
    expect(SOURCE_KIND_LABEL.decision_request).toBe('PM ruling')
    expect(SOURCE_KIND_LABEL.accepted_trade).toBe('Committed trade')
    expect(SOURCE_KIND_LABEL.decision_review).toBe('Review')
    const words = new Set([
      SOURCE_KIND_LABEL.recommendation, SOURCE_KIND_LABEL.decision_request,
      SOURCE_KIND_LABEL.accepted_trade, SOURCE_KIND_LABEL.decision_review,
    ])
    expect(words.size).toBe(4)
  })

  it('opens the asset on the focus its kind belongs to', async () => {
    render(<SourceRef source={source()} />)
    await userEvent.click(screen.getByRole('button'))

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].detail).toMatchObject({
      assetId: 'a-1', symbol: 'AAPL', focus: 'decisions', origin: 'ai-research-trail',
    })
  })

  it('renders plain text, not a dead link, when there is nothing to open', () => {
    render(<SourceRef source={source({ asset_id: null })} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('AAPL PM ruling: pending')).toBeTruthy()
  })

  it('hands an override the source instead of navigating', async () => {
    const onOpen = vi.fn()
    render(<SourceRef source={source()} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button'))

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'dr-1' }))
    expect(dispatched).toHaveLength(0)
  })

  it('is still pressable through an override with no asset to fall back on', async () => {
    const onOpen = vi.fn()
    render(<SourceRef source={source({ asset_id: null })} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalled()
  })
})
