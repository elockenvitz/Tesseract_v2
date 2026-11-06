/**
 * The case-history panel only queries when it is the visible face of the card.
 *
 * This is rendered rather than read as source, because the defect was never
 * visible in the source of one component: `enabled: !!priceTargetId` is
 * perfectly reasonable until you notice that the only caller keeps this
 * mounted behind a CSS transform, so "has an id" meant "always". What is
 * tested here is the query COUNT under each condition, which is the only form
 * the bug ever took.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const supa = vi.hoisted(() => ({ tables: [] as string[] }))

vi.mock('../../../lib/supabase', () => {
  const builder = () => {
    const self: Record<string, unknown> = {}
    const chain = () => self
    Object.assign(self, {
      select: chain,
      eq: chain,
      order: chain,
      in: chain,
      then: (resolve: (r: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    })
    return self
  }
  return {
    supabase: {
      from: (table: string) => {
        supa.tables.push(table)
        return builder()
      },
    },
  }
})

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-me' } }),
}))

import { CaseHistory } from '../CaseHistory'

const PT = 'price-target-1'

function mount(active: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CaseHistory priceTargetId={PT} caseType="bull" active={active} />
    </QueryClientProvider>
  )
  return {
    ...view,
    rerenderWith: (next: boolean) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <CaseHistory priceTargetId={PT} caseType="bull" active={next} />
        </QueryClientProvider>
      ),
  }
}

const historyReads = () => supa.tables.filter(t => t === 'price_target_history').length

/** Real time, not fake: the thing being measured is a `refetchInterval`. */
const waitRealMs = (ms: number) =>
  act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

beforeEach(() => {
  supa.tables.length = 0
})

describe('the panel is silent while it is off screen', () => {
  it('queries nothing when mounted inactive', async () => {
    mount(false)
    /* The card mounts this behind a slide transform, so this is the state it
       is in for every case card on the page, all the time. */
    await waitFor(() => expect(supa.tables).toEqual([]))
    expect(historyReads()).toBe(0)
  })

  it('stays silent over time rather than polling in the background', async () => {
    mount(false)
    await waitRealMs(1200)
    expect(supa.tables).toEqual([])
  })

  it('queries nothing when active but given no price target', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <CaseHistory priceTargetId="" caseType="bull" active />
      </QueryClientProvider>
    )
    await waitFor(() => expect(supa.tables).toEqual([]))
  })
})

describe('opening it reads the history once', () => {
  it('queries when it becomes the visible face', async () => {
    const { rerenderWith } = mount(false)
    expect(historyReads()).toBe(0)
    rerenderWith(true)
    await waitFor(() => expect(historyReads()).toBe(1))
  })

  it('does not keep re-reading while it sits open', async () => {
    /* This is the fix. The old options were `refetchInterval: 500` with
       `staleTime: 0`: two queries (history, then the authors) twice a second
       for as long as a card existed. 1.2s here spans what used to be two
       further ticks. */
    mount(true)
    await waitFor(() => expect(historyReads()).toBe(1))
    await waitRealMs(1200)
    expect(historyReads(), 'the panel is polling again').toBe(1)
  })

  it('does not go back to querying when it is closed again', async () => {
    const { rerenderWith } = mount(true)
    await waitFor(() => expect(historyReads()).toBe(1))
    rerenderWith(false)
    await waitRealMs(1200)
    expect(historyReads()).toBe(1)
  })
})
