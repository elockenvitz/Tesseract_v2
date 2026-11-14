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
import { SOURCE_KIND_LABEL, referenceLabel, toolCallOutcome, toolCallLabel } from '../../../lib/ai/trail-text'
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

  /*
   * The same sentences, now scoped.
   *
   * `emptySentence` and `foundSentence` are asserted exhaustively beside the
   * server's declaration table in `retrieval-visibility.test.ts`, which is
   * where a scope change belongs. These two check the wiring: that
   * `toolCallOutcome` reads the field at all, and that a message carrying no
   * scope still renders the old, weaker, true sentence.
   */
  it('says whose records it counted, when the lookup declared its reach', () => {
    expect(toolCallOutcome(call({ status: 'ok', result_count: 8, scope: 'caller_visible' })).text)
      .toBe('8 records you have access to.')
    expect(toolCallOutcome(call({ status: 'empty', scope: 'caller_visible' })).text)
      .toBe('Nothing that you have access to.')
  })

  it('falls back to a claim about matches for a message with no reach', () => {
    expect(toolCallOutcome(call({ status: 'empty', searched: 'AAPL in team notes' })).text)
      .toBe('No matches for AAPL in team notes.')
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

  /*
   * A title and a date identify a row. They do not let anybody judge it.
   *
   * The trail used to print the tool's raw JSON, which was replaced by a
   * title, a kind and a date -- readable, but still not enough to tell
   * "Channel checks" from the other four notes called "Channel checks". The
   * excerpt is the record in its own words, and the state is what it is doing.
   */
  it('shows the record in its own words', () => {
    render(<SourceRef source={source({
      kind: 'note', title: 'Channel checks',
      excerpt: 'Supplier lead times extended again in the March quarter.',
    })} />)
    expect(screen.getByTestId('ai-source-excerpt').textContent)
      .toBe('Supplier lead times extended again in the March quarter.')
    /* Inside the link, so pressing the words the reader just read opens the
       record they read them from. */
    expect(screen.getByTestId('ai-source-excerpt').closest('button')).toBeTruthy()
  })

  it('shows the record s own state, distinct from the lookup s', () => {
    render(<SourceRef source={source({ kind: 'idea', state: 'ready_to_recommend' })} />)
    expect(screen.getByTestId('ai-source-state').textContent).toBe('Ready to recommend')
  })

  it('renders neither line when the record carries neither', () => {
    render(<SourceRef source={source()} />)
    expect(screen.queryByTestId('ai-source-excerpt')).toBeNull()
    expect(screen.queryByTestId('ai-source-state')).toBeNull()
  })

  it('opens an idea on the decisions focus, not a vaguely related page', () => {
    /* The brief's requirement that a citation lands on the right object. An
       Idea Pipeline entry is a decision-chain record, so it opens where the
       decision chain is read. */
    render(<SourceRef source={source({ kind: 'idea', id: 'i-1' })} />)
    screen.getByRole('button').click()
    expect(dispatched[0].detail).toMatchObject({ assetId: 'a-1', focus: 'decisions' })
  })
})

/**
 * The row leads with a short label, and still says which record it was.
 *
 * It used to lead with an uppercase kind chip and then the record's whole
 * title. For a thesis contribution or a requirement that title is a sentence,
 * so six cited sources read as six record headings competing with the answer
 * above them -- and the two things a reader scans for, which company and what
 * kind of document, were the smallest marks on the row.
 */
describe('a reference reads as a reference', () => {
  it('names the company and the kind, in that order', () => {
    expect(referenceLabel({ kind: 'contribution', symbol: 'aapl' })).toBe('AAPL · Thesis')
    expect(referenceLabel({ kind: 'decision_request', symbol: 'CEG' })).toBe('CEG · PM ruling')
  })

  it('falls back to the kind alone where there is no ticker', () => {
    /* A portfolio or a theme has none, and "· Portfolio" with an empty left
       half reads as a bug rather than as a label. */
    expect(referenceLabel({ kind: 'portfolio', symbol: null })).toBe('Portfolio')
    expect(referenceLabel({ kind: 'theme' })).toBe('Theme')
  })

  it('does not invent a kind for one it has never seen', () => {
    expect(referenceLabel({ kind: 'something_new', symbol: 'X' })).toBe('X · something_new')
    expect(referenceLabel({})).toBe('Record')
  })

  it('renders the label and keeps the record title beside it', () => {
    render(<SourceRef source={source({ kind: 'contribution', symbol: 'AAPL', title: 'Services mix supports a larger terminal multiple than the street carries' })} />)

    expect(screen.getByTestId('ai-source-label').textContent).toBe('AAPL · Thesis')
    /* Kept, because it is what says WHICH thesis. Clamped, not dropped. */
    const title = screen.getByTestId('ai-source-title')
    expect(title.textContent).toMatch(/Services mix supports/)
    expect(title.className).toContain('truncate')
  })
})
