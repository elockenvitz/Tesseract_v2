import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { VerdictBar, type VerdictOption } from '../VerdictBar'

/**
 * The judgment control, tested for the properties Phase 3 exists to guarantee.
 *
 * The layout claims (2×2 at 390px, no horizontal overflow) live in the
 * Playwright suite, because jsdom has no layout engine and every height and
 * width here is zero. What CAN be proven here is the contract: which semantic
 * key reaches the caller, that a double tap writes once, and that a failed
 * write leaves the reader somewhere they can recover from.
 */

const OPTS_4: VerdictOption[] = [
  { key: 'thesis_intact', label: 'Thesis intact', tone: 'affirm', disposition: 'settled', note: 'n1' },
  { key: 'thesis_weaker', label: 'Thesis weaker', tone: 'neutral', disposition: 'flagged', note: 'n2' },
  { key: 'cases_outdated', label: 'Cases outdated', tone: 'neutral', disposition: 'flagged', note: 'n3' },
  { key: 'needs_review', label: 'Review', tone: 'neutral', disposition: 'flagged', note: 'n4' },
]

const OPTS_3: VerdictOption[] = [
  { key: 'still_valid', label: 'Still valid', tone: 'affirm', disposition: 'settled', note: 'n1' },
  { key: 'needs_update', label: 'Needs update', tone: 'neutral', disposition: 'flagged', note: 'n2' },
  { key: 'no_longer_covered', label: 'No longer covered', tone: 'negate', disposition: 'settled', note: 'n3' },
]

const choose = (key: string) => fireEvent.click(screen.getByTestId('verdict-options').querySelector(`[data-verdict="${key}"]`)!)

describe('VerdictBar', () => {
  it('lays four options out as a 2x2 and three as a row', () => {
    const { unmount } = render(<VerdictBar question="Q" options={OPTS_4} onRespond={() => true} />)
    expect(screen.getByTestId('verdict-options').className).toContain('grid-cols-2')
    expect(screen.getByTestId('verdict-options').dataset.optionCount).toBe('4')
    unmount()

    render(<VerdictBar question="Q" options={OPTS_3} onRespond={() => true} />)
    expect(screen.getByTestId('verdict-options').className).toContain('grid-cols-3')
  })

  it('hands the caller the semantic key, not the label', () => {
    // The property the whole phase turns on. Two options that map to the same
    // generic disposition must still arrive distinguishable.
    const onRespond = vi.fn((_o: VerdictOption) => true)
    render(<VerdictBar question="Q" options={OPTS_4} onRespond={onRespond} />)

    choose('cases_outdated')
    fireEvent.click(screen.getByTestId('verdict-send'))
    expect(onRespond.mock.calls[0][0].key).toBe('cases_outdated')
    expect(onRespond.mock.calls[0][0].disposition).toBe('flagged')
  })

  it('keeps two options apart that share one legacy disposition', async () => {
    // `commit` is async, so each submission has to settle before the next
    // begins — otherwise the second tap is swallowed by the in-flight guard and
    // the test measures the guard rather than the contract.
    const seen: string[] = []
    render(
      <VerdictBar question="Q" options={OPTS_4} onRespond={o => { seen.push(`${o.key}:${o.disposition}`); return true }} />,
    )

    choose('thesis_weaker')
    fireEvent.click(screen.getByTestId('verdict-send'))
    await waitFor(() => expect(screen.getByTestId('verdict-saved')).toBeTruthy())

    choose('cases_outdated')
    fireEvent.click(screen.getByTestId('verdict-send'))
    await waitFor(() => expect(seen).toHaveLength(2))

    expect(seen).toEqual(['thesis_weaker:flagged', 'cases_outdated:flagged'])
    // Same generic state, two different judgments — exactly the case the old
    // shape could not represent.
    expect(new Set(seen).size).toBe(2)
  })

  it('treats not_price_driven as a valid deliberate answer, never as rejected', () => {
    // A position held on a non-price framework is a legitimate investment
    // process. Mapping it to `rejected` would file a methodology under feed
    // spam, which is what the previous option set did.
    const valuation: VerdictOption[] = [
      { key: 'price_target', label: 'Price target', disposition: 'flagged', note: 'n' },
      { key: 'case_framework', label: 'Case framework', disposition: 'flagged', note: 'n' },
      { key: 'not_price_driven', label: 'Not price-driven', disposition: 'settled', note: 'n' },
      { key: 'needs_work', label: 'Needs work', disposition: 'flagged', note: 'n' },
    ]
    const onRespond = vi.fn((_o: VerdictOption) => true)
    render(<VerdictBar question="How is this position being valued?" options={valuation} onRespond={onRespond} />)
    choose('not_price_driven')
    fireEvent.click(screen.getByTestId('verdict-send'))
    expect(onRespond.mock.calls[0][0].disposition).toBe('settled')
    expect(onRespond.mock.calls[0][0].disposition).not.toBe('rejected')
  })

  it('cannot be double-submitted by a rapid double tap', async () => {
    let resolve: (v: boolean) => void = () => {}
    const onRespond = vi.fn(() => new Promise<boolean>(r => { resolve = r }))
    render(<VerdictBar question="Q" options={OPTS_4} onRespond={onRespond} />)

    choose('thesis_intact')
    const send = screen.getByTestId('verdict-send')
    fireEvent.click(send)
    fireEvent.click(send)
    fireEvent.click(send)

    expect(onRespond).toHaveBeenCalledTimes(1)
    resolve(true)
    await waitFor(() => expect(screen.getByTestId('verdict-saved')).toBeTruthy())
  })

  it('leaves the reader able to retry when the write fails', async () => {
    // A control that shows a confident selected state over a failed write is
    // worse than one that admits it: the card returns tomorrow and the reader
    // stops trusting the row.
    let ok = false
    const onRespond = vi.fn(() => ok)
    render(<VerdictBar question="Q" options={OPTS_4} onRespond={onRespond} />)

    choose('needs_review')
    fireEvent.click(screen.getByTestId('verdict-send'))
    await waitFor(() => expect(screen.getByTestId('verdict-error')).toBeTruthy())

    // The selection survives, so retrying does not mean re-deciding.
    expect(screen.getByTestId('verdict-options').querySelector('[data-verdict="needs_review"]')!
      .getAttribute('aria-checked')).toBe('true')

    ok = true
    fireEvent.click(screen.getByTestId('verdict-retry'))
    await waitFor(() => expect(screen.getByTestId('verdict-saved')).toBeTruthy())
    expect(onRespond).toHaveBeenCalledTimes(2)
  })

  it('survives a rejected promise the same way', async () => {
    const onRespond = vi.fn(() => Promise.reject(new Error('quota')))
    render(<VerdictBar question="Q" options={OPTS_4} onRespond={onRespond} />)
    choose('thesis_intact')
    fireEvent.click(screen.getByTestId('verdict-send'))
    await waitFor(() => expect(screen.getByTestId('verdict-error')).toBeTruthy())
  })

  it('marks feed-quality options apart from investment judgments', () => {
    // Not yet moved out of the primary set, but findable — which is the whole
    // point of the flag existing before the overflow redesign.
    const mixed: VerdictOption[] = [
      { key: 'agree', label: 'Agree', disposition: 'settled', note: 'n' },
      { key: 'not_relevant', label: 'Not useful', disposition: 'rejected', intent: 'feed_quality', note: 'n' },
    ]
    render(<VerdictBar question="Q" options={mixed} onRespond={() => true} />)
    const row = screen.getByTestId('verdict-options')
    expect(row.querySelector('[data-verdict="agree"]')!.getAttribute('data-intent')).toBe('judgment')
    expect(row.querySelector('[data-verdict="not_relevant"]')!.getAttribute('data-intent')).toBe('feed_quality')
  })

  it('exposes the options as a labelled radio group', () => {
    render(<VerdictBar question="Has the investment view changed?" options={OPTS_4} onRespond={() => true} />)
    const group = screen.getByRole('radiogroup')
    expect(group.getAttribute('aria-labelledby')).toBe('verdict-question')
    expect(screen.getAllByRole('radio')).toHaveLength(4)
  })
})
