import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { VerdictBar, type VerdictOption } from '../VerdictBar'

/**
 * Progressive disclosure: judgment first, optional next step second.
 *
 * The properties under test are mostly about RESTRAINT — that a follow-on
 * appears only when it is routable, only after a successful write, never for
 * feed feedback, and never automatically. A surface that produces a task from
 * every answer is the documentation friction this feed exists to reduce, so
 * "renders nothing" is the expected outcome in most of these.
 */

const opts = (over: Partial<VerdictOption>[] = []): VerdictOption[] => ([
  { key: 'cases_outdated', label: 'Cases outdated', disposition: 'flagged', note: 'n',
    nextAction: { id: 'open_cases', label: 'Review cases' } },
  { key: 'thesis_intact', label: 'Thesis intact', disposition: 'settled', note: 'n' },
  ...over as VerdictOption[],
])

const choose = (key: string) =>
  fireEvent.click(screen.getByTestId('verdict-options').querySelector(`[data-verdict="${key}"]`)!)

const submit = () => fireEvent.click(screen.getByTestId('verdict-send'))

/** Routes anything that declares a nextAction. Stands in for the feed. */
const routeAll = (o: VerdictOption) =>
  o.nextAction ? { label: o.nextAction.label, run: vi.fn() } : null

describe('post-judgment disclosure', () => {
  it('shows the answer, the confirmation, then the optional next step', async () => {
    render(<VerdictBar question="Q" options={opts()} onRespond={() => true} resolveNext={routeAll} />)
    choose('cases_outdated')
    submit()

    const saved = await screen.findByTestId('verdict-saved')
    // The judgment stays visible: it is the contribution, and it is complete.
    expect(saved.textContent).toContain('Cases outdated')
    expect(saved.textContent).toContain('Recorded')
    expect(screen.getByTestId('verdict-next').getAttribute('data-next-label')).toBe('Review cases')
  })

  it('does not navigate when the judgment is selected or submitted', async () => {
    const run = vi.fn()
    render(
      <VerdictBar question="Q" options={opts()} onRespond={() => true}
        resolveNext={o => (o.nextAction ? { label: o.nextAction.label, run } : null)} />,
    )
    choose('cases_outdated')
    expect(run).not.toHaveBeenCalled()
    submit()
    await screen.findByTestId('verdict-saved')
    // The CTA is an offer. Recording an answer must never move the reader.
    expect(run).not.toHaveBeenCalled()
  })

  it('navigates only when the follow-on itself is tapped', async () => {
    const run = vi.fn()
    render(
      <VerdictBar question="Q" options={opts()} onRespond={() => true}
        resolveNext={o => (o.nextAction ? { label: o.nextAction.label, run } : null)} />,
    )
    choose('cases_outdated')
    submit()
    fireEvent.click(await screen.findByTestId('verdict-next'))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('shows no follow-on for a judgment that declares none', async () => {
    // `thesis_intact` is complete on its own. One tap is the whole interaction.
    render(<VerdictBar question="Q" options={opts()} onRespond={() => true} resolveNext={routeAll} />)
    choose('thesis_intact')
    submit()
    await screen.findByTestId('verdict-saved')
    expect(screen.queryByTestId('verdict-next')).toBeNull()
  })

  it('renders no dead CTA when the action does not resolve', async () => {
    // The caller returns null for anything unroutable — an unresolvable
    // follow-on must produce no button rather than a label going nowhere.
    render(<VerdictBar question="Q" options={opts()} onRespond={() => true} resolveNext={() => null} />)
    choose('cases_outdated')
    submit()
    await screen.findByTestId('verdict-saved')
    expect(screen.queryByTestId('verdict-next')).toBeNull()
  })

  it('shows no follow-on while the write has failed', async () => {
    // A CTA beside a failed write would say the answer landed.
    render(<VerdictBar question="Q" options={opts()} onRespond={() => false} resolveNext={routeAll} />)
    choose('cases_outdated')
    submit()
    await screen.findByTestId('verdict-error')
    expect(screen.queryByTestId('verdict-next')).toBeNull()
    expect(screen.queryByTestId('verdict-saved')).toBeNull()
  })

  it('lets the reader change a mis-tapped answer', async () => {
    const onRespond = vi.fn((_o: VerdictOption) => true)
    render(<VerdictBar question="Q" options={opts()} onRespond={onRespond} resolveNext={routeAll} />)
    choose('cases_outdated')
    submit()
    await screen.findByTestId('verdict-saved')

    fireEvent.click(screen.getByTestId('verdict-change'))
    // Options are back, and the old answer is no longer presented as current.
    expect(screen.getByTestId('verdict-options')).toBeTruthy()
    expect(screen.queryByTestId('verdict-saved')).toBeNull()

    choose('thesis_intact')
    submit()
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(2))
    // A correction is a NEW judgment. Nothing edits the first one — the audit
    // row it wrote is history and stays that way.
    expect(onRespond.mock.calls[1][0].key).toBe('thesis_intact')
  })

  it('never offers an investment action for feed feedback', async () => {
    // Guarded at the caller, and asserted here so the contract is visible on
    // both sides: "this story is not relevant to me" must not open a thesis.
    const feedback: VerdictOption[] = [
      { key: 'not_relevant', label: 'Not relevant', disposition: 'rejected', intent: 'feed_quality',
        note: 'n', nextAction: { id: 'update_thesis', label: 'Update thesis' } },
    ]
    render(
      <VerdictBar question="Q" options={feedback} onRespond={() => true}
        resolveNext={o => (o.intent === 'feed_quality' ? null : routeAll(o))} />,
    )
    choose('not_relevant')
    submit()
    await screen.findByTestId('verdict-saved')
    expect(screen.queryByTestId('verdict-next')).toBeNull()
  })
})
