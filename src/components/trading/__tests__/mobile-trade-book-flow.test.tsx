/**
 * The phone's Trade Book, arranged around Trade Book basics.
 *
 * The step banner named three actions — review a trade, add rationale, open
 * Outcomes — and on a phone none of them were in view: the page opened on a
 * list of batch cards, the rationale and trades were inside a batch, and
 * Outcomes was a small chip in the header. Now, for a pilot on a phone, the
 * latest batch opens, it leads with a Next steps card whose rows take you to
 * each action, and it ends with Open Outcomes.
 *
 * Rendered for real at 390px: BatchListView, the banner and the card.
 */
import React, { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: [{}], error: null }) }) }) }) },
}))
vi.mock('../../../hooks/useAcceptedTrades', () => ({ useAcceptedTradeComments: () => ({ data: [] }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../../lib/pilot/pilot-telemetry', () => ({ logPilotEvent: vi.fn() }))

import { BatchListView, type TradeBookGuide } from '../BatchListView'
import { PilotTradeBookGetStarted } from '../../pilot/PilotTradeBookGetStarted'

function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
  }) as unknown as typeof window.matchMedia
}

const batch = { id: 'b-1', name: '1 buy · 09/14/2026', description: null, status: 'active', created_at: '2026-09-14T16:48:17Z', updated_at: '2026-09-14T16:48:17Z', portfolio_id: 'p-1', source_type: 'inbox' } as never
const trade = {
  id: 't-1', batch_id: 'b-1', action: 'add', source: 'inbox', acceptance_note: null,
  asset: { symbol: 'AAPL', company_name: 'Apple Inc.' },
  target_weight: 2, delta_weight: 2, notional_value: 20000, delta_shares: 88,
  execution_status: 'complete', created_at: '2026-09-14T16:48:17Z',
} as never

function Page({ guide, initialSelection = null }: { guide?: TradeBookGuide; initialSelection?: string | null }) {
  const [selected, setSelected] = useState<string | null>(initialSelection)
  return (
    <QueryClientProvider client={new QueryClient()}>
      {guide && <PilotTradeBookGetStarted userId={guide.userId} orgId={guide.orgId} onOpenOutcomes={guide.navigateToOutcomes} />}
      <BatchListView
        batches={[batch]}
        trades={[trade]}
        selectedBatchId={selected}
        onSelectBatch={setSelected}
        onViewBatchTrades={vi.fn()}
        onAddComment={vi.fn()}
        guide={guide}
      />
    </QueryClientProvider>
  )
}

const guide = (navigateToOutcomes = vi.fn()): TradeBookGuide => ({ userId: 'u1', orgId: 'o1', navigateToOutcomes })
const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`) as HTMLElement | null
const stepRow = (key: string) => document.querySelector(`[data-slot="tradebook-next-step"][data-step="${key}"]`) as HTMLElement
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

let scrolled: Element[]
beforeEach(() => {
  localStorage.clear()
  setViewport(390)
  scrolled = []
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) }
})
afterEach(cleanup)

describe('a pilot opening Trade Book on a phone', () => {
  it('lands inside the latest batch, not on the list of batches', () => {
    render(<Page guide={guide()} />)
    expect(slot('tradebook-next-steps')).not.toBeNull()
    expect(screen.getByRole('button', { name: /All batches/ })).toBeTruthy()
  })

  it('reads top to bottom: next steps, batch summary, why this decision, trades, open outcomes', () => {
    render(<Page guide={guide()} />)
    // The batch's own header, inside the opened batch (the hidden list card has the name too).
    const detail = slot('tradebook-next-steps')!.parentElement!
    const order = [
      slot('tradebook-next-steps'),
      within(detail).getByText('1 buy · 09/14/2026'),
      slot('batch-rationale-section'),
      slot('batch-trades-section'),
      slot('tradebook-outcomes-cta'),
    ]
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('labels the batch question and the per-trade notes by scope', () => {
    render(<Page guide={guide()} />)
    const rationale = slot('batch-rationale-section')!
    expect(within(rationale).getByRole('heading', { name: /Why this decision\?/ })).toBeTruthy()
    expect(within(rationale).getByText('Applies to the whole batch')).toBeTruthy()
    expect(within(slot('batch-trades-section')!).getByText('Tap a trade for its details and trade-specific notes')).toBeTruthy()
  })
})

describe('the Next steps rows take you to each action', () => {
  it('Review the trade scrolls to the trades, opens the first one, and ticks the step', async () => {
    render(<Page guide={guide()} />)
    expect(stepRow('reviewed').dataset.state).toBe('next')
    fireEvent.click(stepRow('reviewed'))
    expect(scrolled).toContain(slot('batch-trades-section'))
    expect(screen.getByText('Trade-specific notes')).toBeTruthy()
    expect(screen.getByText('Only for this trade')).toBeTruthy()
    await flush()
    expect(stepRow('reviewed').dataset.state).toBe('done')
    expect(stepRow('rationale').dataset.state).toBe('next')
  })

  it('Add your rationale scrolls to "Why this decision?" and opens its editor', () => {
    render(<Page guide={guide()} />)
    expect(screen.queryByLabelText('Why this decision?')).toBeNull()
    fireEvent.click(stepRow('rationale'))
    expect(scrolled).toContain(slot('batch-rationale-section'))
    expect((screen.getByLabelText('Why this decision?') as HTMLElement).tagName).toBe('TEXTAREA')
  })

  it('Open Outcomes goes there once and records the step — from the row or the button at the end', async () => {
    const navigate = vi.fn()
    const opened = vi.fn()
    window.addEventListener('pilot-tradebook:opened-outcomes', opened)
    render(<Page guide={guide(navigate)} />)
    fireEvent.click(stepRow('outcomes'))
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledTimes(1)
    await flush()
    expect(stepRow('outcomes').dataset.state).toBe('done')

    fireEvent.click(slot('tradebook-open-outcomes')!)
    expect(navigate).toHaveBeenCalledTimes(2)
    window.removeEventListener('pilot-tradebook:opened-outcomes', opened)
  })
})

describe('the banner and the card are one progress', () => {
  it('moves the banner to the next step when the card completes one', async () => {
    render(<Page guide={guide()} />)
    const banner = slot('pilot-steps-banner')!
    expect(within(banner).getAllByText('Review the trade').length).toBeGreaterThan(0)
    fireEvent.click(stepRow('reviewed'))
    await flush()
    // Phone half of the banner shows the current step.
    expect(banner.querySelector('.sm\\:hidden')!.textContent).toContain('Add your rationale')
  })

  it('retires both once all three are done', async () => {
    render(<Page guide={guide()} />)
    fireEvent.click(stepRow('reviewed'))
    await flush()
    act(() => { window.dispatchEvent(new CustomEvent('pilot-tradebook:rationale-added')) })
    await flush()
    fireEvent.click(stepRow('outcomes'))
    await flush()
    expect(slot('tradebook-next-steps')).toBeNull()
    expect(slot('pilot-steps-banner')).toBeNull()
  })
})

describe('unchanged elsewhere', () => {
  it('a phone without the pilot guide gets the list, and no card or Outcomes button in a batch', () => {
    const { unmount } = render(<Page />)
    expect(screen.queryByRole('button', { name: /All batches/ })).toBeNull()
    unmount()
    render(<Page initialSelection="b-1" />)
    expect(slot('tradebook-next-steps')).toBeNull()
    expect(slot('tradebook-outcomes-cta')).toBeNull()
  })

  it('desktop with the guide shows neither the card nor the button', () => {
    setViewport(1440)
    render(<Page guide={guide()} initialSelection="b-1" />)
    expect(slot('tradebook-next-steps')).toBeNull()
    expect(slot('tradebook-outcomes-cta')).toBeNull()
  })
})
