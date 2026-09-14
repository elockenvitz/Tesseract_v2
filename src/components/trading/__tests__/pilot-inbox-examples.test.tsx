/**
 * The Decision Inbox during a pilot: the seeded recommendation is an Example.
 *
 * Three fresh pilots accepted the seeded AAPL request during Pipeline basics,
 * believing it was their own tutorial idea. The real DecisionInbox is rendered
 * here with its data hooks mocked: the seeded request is visible, marked as
 * an Example and has no decision controls; the tutorial idea's own request is
 * actionable; graduated pilots and non-pilots get every control back.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const TUTORIAL = '16437e7b-50e0-44a4-bca8-47b810d50c33' // LLY, Participate Cap
const SEEDED_AAPL = '2a072375-44f0-40ac-bce3-effb1e1f2971'

const pilot = vi.hoisted(() => ({ effectiveIsPilot: true, tutorialIdeaId: '16437e7b-50e0-44a4-bca8-47b810d50c33' as string | null }))
const data = vi.hoisted(() => ({ requests: [] as unknown[] }))
const mutations = vi.hoisted(() => ({
  accept: vi.fn(), reject: vi.fn(), update: vi.fn(), revert: vi.fn(),
}))

vi.mock('../../../hooks/usePilotMode', () => ({ usePilotMode: () => ({ effectiveIsPilot: pilot.effectiveIsPilot }) }))
vi.mock('../../../hooks/usePilotProgress', () => ({ usePilotProgress: () => ({ tutorialIdeaId: pilot.tutorialIdeaId }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../common/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../../hooks/useDecisionRequests', () => ({
  useAllDecisionRequests: () => ({ data: data.requests, isLoading: false }),
  useAcceptFromInbox: () => ({ mutate: mutations.accept, mutateAsync: mutations.accept, isPending: false }),
  useRejectFromInbox: () => ({ mutate: mutations.reject, isPending: false }),
  useUpdateDecisionRequest: () => ({ mutate: mutations.update, isPending: false }),
  useRevertDecisionAccept: () => ({ mutate: mutations.revert, isPending: false }),
}))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    // No portfolio_team rows, as in a fresh pilot org; the pilot is org admin.
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, in: () => chain,
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
      }
      return chain
    },
    rpc: async () => ({ data: true, error: null }),
  },
}))

import { DecisionInbox } from '../DecisionInbox'

const request = (id: string, tqi: string, symbol: string, over: Record<string, unknown> = {}) => ({
  id, status: 'pending', trade_queue_item_id: tqi, portfolio_id: 'p1', requested_by: 'u1',
  created_at: '2026-09-14T15:28:13Z', urgency: 'medium', sizing_weight: 2,
  portfolio: { id: 'p1', name: 'Tech & Consumer Growth' },
  requester: { id: 'u1', first_name: 'Pilot', last_name: 'User', email: 'p@x.test' },
  trade_queue_item: { id: tqi, action: 'add', assets: { symbol, company_name: `${symbol} Inc` } },
  submission_snapshot: { weight: 2, baseline_weight: 0, pilot_seed: symbol === 'AAPL' },
  ...over,
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DecisionInbox />
    </QueryClientProvider>,
  )
}

/** The idea card holding a symbol. */
async function card(symbol: string) {
  const heading = await screen.findByText(symbol, { selector: 'button' })
  let el: HTMLElement | null = heading
  while (el && !el.className.includes('rounded-lg border overflow-hidden')) el = el.parentElement
  return el as HTMLElement
}

const decisionButtons = (el: HTMLElement) =>
  within(el).queryAllByRole('button').filter(b => /^(Accept|Reject|Defer)$/.test(b.textContent?.trim() ?? ''))

beforeEach(() => {
  pilot.effectiveIsPilot = true
  pilot.tutorialIdeaId = TUTORIAL
  data.requests = [request('dr-aapl', SEEDED_AAPL, 'AAPL')]
  Object.values(mutations).forEach(m => m.mockReset())
})
afterEach(cleanup)

describe('an active pilot', () => {
  it('sees the seeded AAPL request as an Example, with no decision controls', async () => {
    mount()
    const aapl = await card('AAPL')
    expect(within(aapl).getByText('Example', { selector: '[data-slot="pilot-example-note"] span' })).toBeTruthy()
    // It points at where the recommendation can be used: Trade Lab.
    expect(within(aapl).getByText(/Add it in Trade Lab to size and execute it/)).toBeTruthy()
    expect(decisionButtons(aapl)).toHaveLength(0)
    expect(within(aapl).queryByText('Pending your decision')).toBeNull()
  })

  it('can act on the tutorial idea’s own request', async () => {
    data.requests = [request('dr-aapl', SEEDED_AAPL, 'AAPL'), request('dr-lly', TUTORIAL, 'LLY', { pilot_seed: false })]
    mount()
    const lly = await card('LLY')
    expect(lly.querySelector('[data-slot="pilot-example-note"]')).toBeNull()
    expect(decisionButtons(lly).map(b => b.textContent?.trim())).toEqual(['Accept', 'Reject', 'Defer'])
    // And the Example beside it still has none.
    expect(decisionButtons(await card('AAPL'))).toHaveLength(0)
  })

  it('treats every request as an Example before a tutorial idea exists', async () => {
    pilot.tutorialIdeaId = null
    mount()
    expect(decisionButtons(await card('AAPL'))).toHaveLength(0)
  })

  it('only the tutorial request can reach a decision mutation', async () => {
    data.requests = [request('dr-aapl', SEEDED_AAPL, 'AAPL'), request('dr-lly', TUTORIAL, 'LLY')]
    mount()
    const lly = await card('LLY')
    fireEvent.click(decisionButtons(lly)[0])
    const confirm = within(lly).getAllByRole('button').find(b => /Accept/.test(b.textContent ?? '') && b !== decisionButtons(lly)[0])
    if (confirm) fireEvent.click(confirm)
    for (const call of mutations.accept.mock.calls) {
      expect((call[0] as { decisionRequest: { id: string } }).decisionRequest.id).toBe('dr-lly')
    }
    expect(mutations.reject).not.toHaveBeenCalled()
    expect(mutations.update).not.toHaveBeenCalled()
  })
})

describe('everyone else', () => {
  it.each([
    ['a graduated pilot', () => { pilot.effectiveIsPilot = false }],
    ['a non-pilot', () => { pilot.effectiveIsPilot = false; pilot.tutorialIdeaId = null }],
  ])('%s gets the normal controls on the same request', async (_name, setup) => {
    setup()
    mount()
    const aapl = await card('AAPL')
    expect(aapl.querySelector('[data-slot="pilot-example-note"]')).toBeNull()
    expect(decisionButtons(aapl).map(b => b.textContent?.trim())).toEqual(['Accept', 'Reject', 'Defer'])
  })
})

describe('Pipeline basics step 2 is opening the Inbox, not deciding', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

  it('is marked when the drawer opens, on the board and on a phone', () => {
    expect(src('pages/TradeQueuePage.tsx')).toContain("markPilotStage('pipeline_step_inbox')")
    const phone = src('components/mobile/MobilePipeline.tsx')
    expect(phone).toMatch(/const toggleInbox = \(\) => setInboxCollapsed\(prev => \{[\s\S]*?markPilotStage\('pipeline_step_inbox'\)/)
    // No decision mutation marks it.
    for (const f of ['components/trading/DecisionInbox.tsx', 'hooks/useDecisionRequests.ts']) {
      expect(src(f)).not.toContain('pipeline_step_inbox')
    }
  })

  it('no longer tells the pilot the recommendation waits for their decision', () => {
    const banner = src('hooks/usePilotPipelineBanner.ts')
    expect(banner).not.toMatch(/hint: '[^']*wait for your decision/)
    expect(banner).toContain('examples there are just to look at')
  })
})

describe('the other surface that decides requests', () => {
  it('PendingReviewList applies the same rule', () => {
    const thoughts = readFileSync(path.join(process.cwd(), 'src/components/communication/ThoughtsSection.tsx'), 'utf8')
    expect(thoughts).toContain('const canDecide = isPMForPortfolio && !reqIsExample')
    expect(thoughts).toMatch(/const handleAccept = async \(req: any\) => \{\s*if \(isExample\(req\)\) return/)
    expect(thoughts).toMatch(/const handleReject = async \(req: any\) => \{\s*if \(isExample\(req\)\) return/)
  })
})
