/**
 * The phone's Trade Book during Trade Book basics: one page, in step order.
 *
 * The amber banner carries tutorial progress and nothing else; the batch page
 * itself carries no step labels, because it is the same page outside Getting
 * Started. It reads summary, trades, "Why this decision?", and during the
 * tutorial ends with one Open Outcomes button — the only way to Outcomes on the
 * page. Step 2 is the batch's answer; a trade-specific note does not count.
 *
 * Rendered for real at 390px: the banner and BatchListView.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'b-1' }], error: null }) }) }) }) },
}))
vi.mock('../../../hooks/useAcceptedTrades', () => ({ useAcceptedTradeComments: () => ({ data: [] }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../../lib/pilot/pilot-telemetry', () => ({ logPilotEvent: vi.fn() }))
const progressMark = vi.hoisted(() => vi.fn())
vi.mock('../../../hooks/usePilotProgress', () => ({ usePilotProgress: () => ({ progress: {}, mark: progressMark }) }))

import { BatchListView, type TradeBookGuide } from '../BatchListView'
import { PilotTradeBookGetStarted } from '../../pilot/PilotTradeBookGetStarted'
import { resetTradeBookStageMarkRequests } from '../../../hooks/usePilotTradeBookSteps'

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

function Page({ guide, initialSelection = null, onAddComment = vi.fn() }: { guide?: TradeBookGuide; initialSelection?: string | null; onAddComment?: (id: string, c: string) => void }) {
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
        onAddComment={onAddComment}
        guide={guide}
      />
    </QueryClientProvider>
  )
}

const guide = (navigateToOutcomes = vi.fn()): TradeBookGuide => ({ userId: 'u1', orgId: 'o1', navigateToOutcomes })
const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`) as HTMLElement | null
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const bannerPhone = () => slot('pilot-steps-banner')!.querySelector('.sm\\:hidden') as HTMLElement
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

beforeEach(() => {
  localStorage.clear()
  progressMark.mockReset()
  resetTradeBookStageMarkRequests()
  setViewport(390)
})
afterEach(cleanup)

describe('a pilot on a phone during Trade Book basics', () => {
  it('lands inside the latest batch', () => {
    render(<Page guide={guide()} />)
    expect(screen.getByRole('button', { name: /All batches/ })).toBeTruthy()
    expect(slot('batch-trades-section')).not.toBeNull()
  })

  it('reads summary, trades, why this decision, then open outcomes', () => {
    render(<Page guide={guide()} />)
    const trades = slot('batch-trades-section')!
    const rationale = slot('batch-rationale-section')!
    const cta = slot('tradebook-outcomes-cta')!
    const summary = within(trades.parentElement!).getByText('1 buy · 09/14/2026')
    expect(follows(summary, trades)).toBe(true)
    expect(follows(trades, rationale)).toBe(true)
    expect(follows(rationale, cta)).toBe(true)
    expect(within(rationale).getByRole('heading', { name: /Why this decision\?/ })).toBeTruthy()
  })

  /**
   * The batch page is the durable page, not the tutorial. Getting Started
   * progress lives in the banner only, so the sections carry no step labels.
   */
  it('labels no section with a tutorial step', () => {
    render(<Page guide={guide()} />)
    const detail = slot('batch-trades-section')!.parentElement!
    expect(detail.textContent).not.toMatch(/Step [123]/)
  })

  it('shows the same sections, with the same names, with or without the tutorial', () => {
    const headings = () => Array.from(document.querySelectorAll('[data-slot="batch-trades-section"] h3, [data-slot="batch-rationale-section"] h3')).map(h => h.textContent)
    const { unmount } = render(<Page guide={guide()} />)
    const during = headings()
    unmount()
    render(<Page initialSelection="b-1" />)
    expect(headings()).toEqual(during)
  })

  it('has no Next steps card', () => {
    render(<Page guide={guide()} />)
    expect(slot('tradebook-next-steps')).toBeNull()
    expect(document.querySelector('[data-slot="tradebook-next-step"]')).toBeNull()
  })

  it('has exactly one Open Outcomes action, at the bottom, and a banner that is progress only', () => {
    // On step 3, where the banner used to offer its own Open Outcomes arrow.
    localStorage.setItem('pilot_tradebook_intro_reviewed_u1_o1', '1')
    localStorage.setItem('pilot_tradebook_intro_rationale_u1_o1', '1')
    render(<Page guide={guide()} />)
    const phone = bannerPhone()
    expect(phone.textContent).toContain('Open Outcomes')
    expect(phone.querySelector('[data-slot="pilot-steps-cta"]')).toBeNull()
    expect(phone.querySelector('[data-slot="pilot-steps-action"]')).toBeNull()
    expect(within(phone).queryAllByRole('button')).toHaveLength(0)
    const outcomesButtons = Array.from(document.querySelectorAll('button')).filter(b => /Open Outcomes/.test(b.textContent ?? '') && !b.closest('.sm\\:flex'))
    expect(outcomesButtons).toHaveLength(1)
    expect(outcomesButtons[0].dataset.slot).toBe('tradebook-open-outcomes')
  })

  it('hides Open in Trades on a phone', () => {
    render(<Page guide={guide()} />)
    const openInTrades = screen.getByRole('button', { name: /Open in Trades/ })
    expect(openInTrades.className).toContain('max-md:hidden')
  })
})

describe('the steps complete from the page', () => {
  it('step 1: tapping a trade reviews it', async () => {
    render(<Page guide={guide()} />)
    expect(bannerPhone().textContent).toContain('Review the trade')
    fireEvent.click(document.querySelector('[data-slot="tradebook-mobile-trade"]')!)
    await flush()
    expect(bannerPhone().textContent).toContain('Add your rationale')
  })

  it('step 2: a trade-specific note is optional and does not complete it', async () => {
    const onAddComment = vi.fn()
    render(<Page guide={guide()} onAddComment={onAddComment} />)
    fireEvent.click(document.querySelector('[data-slot="tradebook-mobile-trade"]')!)
    await flush()
    // Step 1 moved the reader on; reopen the trade and its notes on purpose.
    fireEvent.click(document.querySelector('[data-slot="tradebook-mobile-trade"]')!)
    await flush()
    expect(screen.getByText('Optional · only for this trade')).toBeTruthy()
    fireEvent.click(slot('trade-rationale-toggle')!)
    fireEvent.change(screen.getByLabelText('Add a trade-specific note'), { target: { value: 'Guidance raised.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await flush()
    expect(onAddComment).toHaveBeenCalledWith('t-1', 'Guidance raised.')
    expect(bannerPhone().textContent).toContain('Add your rationale')
  })

  it('step 2: saving "Why this decision?" completes it', async () => {
    render(<Page guide={guide()} />)
    fireEvent.click(document.querySelector('[data-slot="tradebook-mobile-trade"]')!)
    await flush()
    // Step 1 opened the editor itself.
    fireEvent.change(screen.getByLabelText('Why this decision?'), { target: { value: 'Adding on weakness ahead of the print.' } })
    fireEvent.click(screen.getByRole('button', { name: /Save rationale/ }))
    await flush()
    await flush()
    expect(bannerPhone().textContent).toContain('Open Outcomes')
  })

  it('step 3: Open Outcomes navigates once, records the step, and finishing all three writes stage 4', async () => {
    const navigate = vi.fn()
    const opened = vi.fn()
    window.addEventListener('pilot-tradebook:opened-outcomes', opened)
    render(<Page guide={guide(navigate)} />)
    fireEvent.click(document.querySelector('[data-slot="tradebook-mobile-trade"]')!)
    await flush()
    act(() => { window.dispatchEvent(new CustomEvent('pilot-tradebook:rationale-added')) })
    await flush()
    expect(progressMark).not.toHaveBeenCalledWith('tradebook_basics_completed')
    fireEvent.click(slot('tradebook-open-outcomes')!)
    await flush()
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledTimes(1)
    expect(slot('pilot-steps-banner')).toBeNull()
    expect(progressMark).toHaveBeenCalledWith('tradebook_basics_completed')
    window.removeEventListener('pilot-tradebook:opened-outcomes', opened)
  })
})

describe('moving from step 1 to step 2 on a phone', () => {
  const tradeCard = () => document.querySelector('[data-slot="tradebook-mobile-trade"]') as HTMLElement
  const scrolled = vi.fn()
  beforeEach(() => {
    scrolled.mockReset()
    Element.prototype.scrollIntoView = function (this: Element) { scrolled(this) } as never
  })
  const waitFrame = () => act(async () => { await new Promise(r => setTimeout(r, 40)) })

  it('shuts the reviewed trade, opens Why this decision? and takes the reader there', async () => {
    render(<Page guide={guide()} />)
    fireEvent.click(tradeCard())
    await flush()
    await waitFrame()
    expect(tradeCard().getAttribute('aria-expanded')).toBe('false')
    expect(slot('trade-rationale-mobile')).toBeNull()
    const editor = screen.getByLabelText('Why this decision?')
    expect(slot('batch-rationale-section')!.contains(editor)).toBe(true)
    expect(document.activeElement).toBe(editor)
    expect(scrolled).toHaveBeenCalledWith(slot('batch-rationale-section'))
  })

  it('scrolls to an existing rationale without forcing it into edit', async () => {
    const described = { ...(batch as object), description: 'Already explained.' } as never
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BatchListView batches={[described]} trades={[trade]} selectedBatchId="b-1" onSelectBatch={vi.fn()} onViewBatchTrades={vi.fn()} onAddComment={vi.fn()} guide={guide()} />
      </QueryClientProvider>,
    )
    fireEvent.click(tradeCard())
    await flush()
    await waitFrame()
    expect(slot('batch-rationale-editor-mobile')).toBeNull()
    expect(slot('batch-rationale-saved-mobile')).not.toBeNull()
    expect(scrolled).toHaveBeenCalledWith(slot('batch-rationale-section'))
    expect(document.activeElement).toBe(slot('batch-rationale-section'))
  })

  it('does not move the reader once step 1 is already done', async () => {
    localStorage.setItem('pilot_tradebook_intro_reviewed_u1_o1', '1')
    render(<Page guide={guide()} />)
    fireEvent.click(tradeCard())
    await flush()
    await waitFrame()
    expect(tradeCard().getAttribute('aria-expanded')).toBe('true')
    expect(slot('batch-rationale-editor-mobile')).toBeNull()
    expect(scrolled).not.toHaveBeenCalled()
  })

  it('does not move the reader outside the tutorial', async () => {
    render(<Page initialSelection="b-1" />)
    fireEvent.click(tradeCard())
    await flush()
    await waitFrame()
    expect(tradeCard().getAttribute('aria-expanded')).toBe('true')
    expect(slot('batch-rationale-editor-mobile')).toBeNull()
  })

  it('keeps an opened trade’s notes shut, labelled optional, until asked for', async () => {
    localStorage.setItem('pilot_tradebook_intro_reviewed_u1_o1', '1')
    render(<Page guide={guide()} />)
    fireEvent.click(tradeCard())
    await flush()
    const toggle = slot('trade-rationale-toggle')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('Trade-specific notes')
    expect(toggle.textContent).toContain('Optional · only for this trade')
    expect(screen.queryByLabelText('Add a trade-specific note')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('Add a trade-specific note')).toBeTruthy()
  })
})

describe('the batch list card’s rationale nudge', () => {
  it('on a phone opens that batch at Why this decision?, editor open', async () => {
    Element.prototype.scrollIntoView = vi.fn() as never
    render(<Page />)
    fireEvent.click(slot('batch-card-add-rationale')!)
    await flush()
    expect(screen.getByRole('button', { name: /All batches/ })).toBeTruthy()
    const editor = screen.getByLabelText('Why this decision?')
    expect(slot('batch-rationale-section')!.contains(editor)).toBe(true)
  })

  it('elsewhere on the card just opens the batch', async () => {
    render(<Page />)
    fireEvent.click(screen.getByText('1 buy · 09/14/2026'))
    await flush()
    expect(screen.getByRole('button', { name: /All batches/ })).toBeTruthy()
    expect(slot('batch-rationale-editor-mobile')).toBeNull()
  })

  it('on desktop selects the batch without opening the editor', async () => {
    setViewport(1440)
    render(<Page />)
    fireEvent.click(slot('batch-card-add-rationale')!)
    await flush()
    expect(screen.queryByLabelText('Why this decision?')).toBeNull()
    expect(screen.getByText('Explain why you made this decision')).toBeTruthy()
  })
})

describe('finishing with Open Outcomes, which leaves Trade Book in the same tap', () => {
  /**
   * The reported bug (Golf Cap, 2026-09-14): Open Outcomes navigated away and
   * unmounted Trade Book before the stage-4 mark was written, so the Dashboard
   * stayed on stage 4 until Trade Book mounted again ~7s later. Here the
   * navigation unmounts the page synchronously, as switching tabs does.
   */
  it('writes the stage 4 mark before the page is gone', async () => {
    localStorage.setItem('pilot_tradebook_intro_reviewed_u1_o1', '1')
    localStorage.setItem('pilot_tradebook_intro_rationale_u1_o1', '1')
    let unmountPage = () => {}
    const view = render(<Page guide={guide(() => unmountPage())} />)
    unmountPage = view.unmount
    fireEvent.click(slot('tradebook-open-outcomes')!)
    expect(slot('tradebook-open-outcomes')).toBeNull()
    expect(progressMark).toHaveBeenCalledWith('tradebook_basics_completed')
  })

  it('asks for the mark once, though the banner and the batch page both track the steps', async () => {
    localStorage.setItem('pilot_tradebook_intro_reviewed_u1_o1', '1')
    localStorage.setItem('pilot_tradebook_intro_rationale_u1_o1', '1')
    render(<Page guide={guide()} />)
    fireEvent.click(slot('tradebook-open-outcomes')!)
    await flush()
    await flush()
    expect(progressMark.mock.calls.filter(c => c[0] === 'tradebook_basics_completed')).toHaveLength(1)
  })

  it('does not write it when an earlier step is still open', async () => {
    localStorage.setItem('pilot_tradebook_intro_reviewed_u1_o1', '1')
    let unmountPage = () => {}
    const view = render(<Page guide={guide(() => unmountPage())} />)
    unmountPage = view.unmount
    fireEvent.click(slot('tradebook-open-outcomes')!)
    expect(progressMark).not.toHaveBeenCalledWith('tradebook_basics_completed')
  })
})

describe('unchanged elsewhere', () => {
  it('desktop keeps its order, Open in Trades, the clickable banner step and no bottom button', () => {
    setViewport(1440)
    render(<Page guide={guide()} initialSelection="b-1" />)
    expect(follows(slot('batch-rationale-section')!, slot('batch-trades-section')!)).toBe(true)
    expect(slot('tradebook-outcomes-cta')).toBeNull()
    // The banner's desktop half still offers step 3.
    const desktopHalf = slot('pilot-steps-banner')!.querySelector('.sm\\:flex') as HTMLElement
    expect(within(desktopHalf).getByRole('button', { name: /Open Outcomes/ })).toBeTruthy()
  })

  it('a phone without the tutorial gets no bottom Outcomes button', () => {
    render(<Page initialSelection="b-1" />)
    expect(slot('tradebook-outcomes-cta')).toBeNull()
  })

  it('the header Outcomes shortcut is hidden on a phone only while the tutorial is active', () => {
    const page = readFileSync(path.join(process.cwd(), 'src/pages/TradeBookPage.tsx'), 'utf8')
    const header = page.slice(page.indexOf('data-slot="tradebook-header-outcomes"') - 800, page.indexOf('data-slot="tradebook-header-outcomes"'))
    expect(header).toContain("showPilotBasics && 'max-md:hidden'")
  })
})
