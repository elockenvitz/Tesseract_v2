/**
 * The one evidence section, as a reader meets it.
 *
 * `evidence.test.ts` covers the consolidation itself. This covers what
 * reaches the screen: that a record appears once rather than twice, that
 * "quoted" is still distinguishable from "consulted", that a failed lookup is
 * visible before anything is expanded, and that a source still navigates to
 * the right object.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiEvidence } from '../AiEvidence'
import type { AiSourceRef, MessageCitation, MessageToolCall } from '../../../lib/ai/presentation'

/* Typed, not `Record<string, unknown>`: a loose fixture let a `kind` that is
   not an `AiSourceKind` through, and the test then proved nothing about a
   source the application can actually produce. */
const source = (over: Partial<AiSourceRef> = {}): AiSourceRef => ({
  kind: 'decision_request' as const,
  id: 'dr1',
  asset_id: 'a1',
  symbol: 'AAPL',
  title: 'AAPL PM ruling: pending',
  timestamp: '2026-11-01T00:00:00Z',
  ...over,
})

const call = (over: Partial<MessageToolCall> = {}): MessageToolCall => ({
  name: 'get_decisions',
  input: { symbol: 'AAPL' },
  status: 'ok',
  result_count: 1,
  sources: [source()],
  ...over,
})

const citation = (over: Partial<MessageCitation> = {}): MessageCitation => ({
  document_title: 'AAPL PM ruling: pending',
  cited_text: 'The committee deferred pending a valuation refresh.',
  kind: 'decision_request',
  document_id: 'dr1',
  asset_id: 'a1',
  symbol: 'AAPL',
  ...over,
})

describe('a record is listed once', () => {
  it('shows one row for a record that was both quoted and looked up', () => {
    /*
     * The reported defect. This used to render as a research trail entry AND
     * a citations entry, under two headings, with no way for a reader to tell
     * it was one record.
     */
    render(<AiEvidence toolCalls={[call()]} citations={[citation()]} defaultOpen />)
    expect(screen.getAllByText('AAPL PM ruling: pending')).toHaveLength(1)
  })

  it('shows one row for a record two lookups both returned', () => {
    render(
      <AiEvidence
        toolCalls={[call({ name: 'get_asset' }), call({ name: 'get_decisions' })]}
        defaultOpen
      />,
    )
    expect(screen.getAllByText('AAPL PM ruling: pending')).toHaveLength(1)
  })

  it('counts sources in the heading, not lookups', () => {
    /* Two lookups, one record. The old heading said "Research (2)", which
       counted the machine's actions and read as diagnostics. */
    render(
      <AiEvidence toolCalls={[call({ name: 'get_asset' }), call()]} defaultOpen />,
    )
    expect(screen.getByTestId('ai-evidence-heading').textContent).toBe('1 source')
  })
})

describe('quoted and consulted stay distinguishable', () => {
  it('marks a cited record as quoted', () => {
    render(<AiEvidence toolCalls={[call()]} citations={[citation()]} defaultOpen />)
    expect(screen.getByTestId('ai-evidence-relation').getAttribute('data-relation')).toBe('quoted')
  })

  it('marks a record that was only looked at as consulted', () => {
    /*
     * The substance of the two old sections. A reader who cannot tell these
     * apart may take a list of files the model opened as support for a
     * specific sentence, which is a stronger claim than was made.
     */
    render(<AiEvidence toolCalls={[call()]} defaultOpen />)
    expect(screen.getByTestId('ai-evidence-relation').getAttribute('data-relation')).toBe('consulted')
  })

  it('shows the record s own words', () => {
    render(<AiEvidence citations={[citation()]} defaultOpen />)
    expect(screen.getByTestId('ai-source-excerpt').textContent)
      .toContain('deferred pending a valuation refresh')
  })

  it('says how many further quotations there are rather than listing them all', () => {
    render(
      <AiEvidence
        citations={[citation(), citation({ cited_text: 'Target raised to 260.' })]}
        defaultOpen
      />,
    )
    expect(screen.getByText('+1 more')).toBeTruthy()
  })
})

describe('a failed lookup is visible before anything is opened', () => {
  it('warns on the collapsed header', () => {
    /*
     * Collapsed is the default in the chat pane, so a failure that only
     * appeared once expanded would be a failure most readers never saw -- and
     * a failed lookup is the one thing here that changes what they should
     * believe about the answer.
     */
    render(<AiEvidence toolCalls={[call({ status: 'error', sources: [], result_count: 0 })]} />)
    expect(screen.getByTestId('ai-evidence-failed')).toBeTruthy()
  })

  it('does not warn when every lookup ran', () => {
    render(<AiEvidence toolCalls={[call()]} />)
    expect(screen.queryByTestId('ai-evidence-failed')).toBeNull()
  })

  it('names the lookup that failed once expanded, even though records exist', () => {
    /* Lookup labels are normally demoted. A failure is the exception: the
       reader needs to know WHICH lookup was missing. */
    render(
      <AiEvidence
        toolCalls={[call(), call({ name: 'get_portfolio_holdings', status: 'error', sources: [], result_count: 0 })]}
        defaultOpen
      />,
    )
    expect(screen.getByText(/From 2 lookups, 1 of which failed/)).toBeTruthy()
    expect(screen.getByText(/This lookup failed/)).toBeTruthy()
  })

  it('shows a permission-scoped absence in the scoped words, not the firm s', () => {
    render(
      <AiEvidence
        toolCalls={[call({
          status: 'empty', sources: [], result_count: 0,
          searched: 'AAPL', scope: 'caller_visible',
        })]}
        defaultOpen
      />,
    )
    expect(screen.getByText(/you have access to/)).toBeTruthy()
    expect(screen.queryByText(/in your organization/)).toBeNull()
  })
})

describe('the section earns its space', () => {
  it('renders nothing when there is no evidence at all', () => {
    const { container } = render(<AiEvidence />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for empty arrays', () => {
    const { container } = render(<AiEvidence toolCalls={[]} citations={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('stays collapsed by default and opens on the press', async () => {
    render(<AiEvidence toolCalls={[call()]} />)
    expect(screen.queryByText('AAPL PM ruling: pending')).toBeNull()
    await userEvent.click(screen.getByTitle('Show sources'))
    expect(screen.getByText('AAPL PM ruling: pending')).toBeTruthy()
  })

  it('opens from the start where the surface asks for it', () => {
    render(<AiEvidence toolCalls={[call()]} defaultOpen />)
    expect(screen.getByText('AAPL PM ruling: pending')).toBeTruthy()
  })
})

describe('a source still opens the right object', () => {
  it('hands the record back to the surface s own handler', () => {
    const onOpenSource = vi.fn()
    render(<AiEvidence toolCalls={[call()]} defaultOpen onOpenSource={onOpenSource} />)
    screen.getByTitle('Open AAPL PM ruling: pending').click()
    expect(onOpenSource).toHaveBeenCalledTimes(1)
    expect(onOpenSource.mock.calls[0][0]).toMatchObject({ kind: 'decision_request', id: 'dr1' })
  })

  it('keeps the richer reference when two lookups describe one record', () => {
    /* The merged row must navigate using whichever lookup actually carried
       the asset id, or deduplication would cost the link. */
    const onOpenSource = vi.fn()
    render(
      <AiEvidence
        toolCalls={[call({ sources: [source({ asset_id: null })] }), call({ sources: [source()] })]}
        defaultOpen
        onOpenSource={onOpenSource}
      />,
    )
    screen.getByTitle('Open AAPL PM ruling: pending').click()
    expect(onOpenSource.mock.calls[0][0].asset_id).toBe('a1')
  })
})

describe('an old record says how old it is', () => {
  /*
   * The date was already on the row, in the lightest grey on the line, which
   * is provenance and nearly useless for the question a reader has: a thesis
   * from March and one from last week scan identically, and only one of them
   * should be leaned on.
   */
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

  it('marks a record old enough to change how it is weighed', () => {
    render(
      <AiEvidence
        toolCalls={[call({ sources: [source({ timestamp: daysAgo(240) })] })]}
        defaultOpen
      />,
    )
    expect(screen.getByTestId('ai-source-age').textContent).toBe('8 months old')
  })

  it('says nothing on a recent record, so the mark keeps its meaning', () => {
    /* A badge on every row is a badge nobody reads. */
    render(
      <AiEvidence
        toolCalls={[call({ sources: [source({ timestamp: daysAgo(4) })] })]}
        defaultOpen
      />,
    )
    expect(screen.queryByTestId('ai-source-age')).toBeNull()
  })

  it('keeps the exact date beside the age, never instead of it', () => {
    /* Provenance. "8 months old" is a reading of the timestamp; the
       timestamp itself is the fact, and the reader can still see it. */
    render(
      <AiEvidence
        toolCalls={[call({ sources: [source({ timestamp: '2026-03-12T00:00:00Z' })] })]}
        defaultOpen
      />,
    )
    expect(screen.getByTestId('ai-source-age')).toBeTruthy()
    /* Month and year, not the day: a UTC midnight renders as the previous
       local date west of Greenwich, and the runner's timezone is not the
       subject of this test. */
    expect(screen.getByText(/Mar\b.*2026/)).toBeTruthy()
  })
})
