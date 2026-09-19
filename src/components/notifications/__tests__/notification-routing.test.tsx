/**
 * What happens when you tap a notification.
 *
 * ── The defects this pins ─────────────────────────────────────────────────
 *
 * 1. Expired price targets had no destination at all. The pane's navigation
 *    switch handled `asset`, `note`, `workflow` and `task` — never
 *    `price_target`, which is the context type every expiry notification
 *    carried. The alert said three AMZN targets needed review and then
 *    refused to open AMZN.
 *
 * 2. The pane resolved a destination and the Layout threw it away. The
 *    handler that receives it read `if (notification.type === 'asset')`, so
 *    notes and lists resolved correctly and then went nowhere — no
 *    navigation, and the pane stayed open. On a phone the pane is a
 *    full-height sheet, so the tap produced no visible effect whatsoever.
 *
 * 3. Six rows for three targets. The pane folds them before drawing, so the
 *    backlog already in a pilot's inbox reads as one line.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const AMZN = '22222222-2222-2222-2222-222222222222'

let rows: any[] = []

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('../../../lib/supabase', () => {
  const api: any = {}
  api.select = () => api
  api.eq = () => api
  api.in = () => api
  api.update = () => api
  api.order = () => api
  api.limit = () => Promise.resolve({ data: rows, error: null })
  return { supabase: { from: () => api } }
})

import { NotificationPane } from '../NotificationPane'

function expired(over: Record<string, any> = {}) {
  return {
    id: over.id ?? 'n1',
    user_id: 'user-1',
    type: 'price_target_expired',
    title: 'Price Target Expired: AMZN Bull',
    message: 'Your Bull price target of $220 for Amazon (AMZN) expired on Mar 14, 2026.',
    // The shape every row emitted before the grouping migration carries.
    context_type: 'price_target',
    context_id: over.price_target_id ?? 'pt-bull',
    context_data: {
      organization_id: 'org-1',
      asset_id: AMZN,
      asset_symbol: 'AMZN',
      asset_name: 'Amazon.com Inc',
      price_target_id: over.price_target_id ?? 'pt-bull',
      scenario_name: over.scenario ?? 'Bull',
      target_price: over.target_price ?? 220,
      // The expiry date is the event boundary; three cases set together share
      // one horizon.
      target_date: '2026-03-14',
    },
    is_read: false,
    created_at: '2026-03-15T09:00:00.000Z',
    read_at: null,
    ...over,
  }
}

async function view() {
  const onNotificationClick = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const r = render(
    <QueryClientProvider client={client}>
      <NotificationPane
        isOpen
        onToggle={() => {}}
        isFullscreen={false}
        onToggleFullscreen={() => {}}
        onNotificationClick={onNotificationClick}
      />
    </QueryClientProvider>,
  )
  await screen.findAllByText(/AMZN/)
  return { ...r, onNotificationClick }
}

beforeEach(() => {
  rows = []
})

describe('an expired-target notification opens the asset', () => {
  beforeEach(() => {
    rows = [expired()]
  })

  it('resolves a destination instead of doing nothing', async () => {
    const { onNotificationClick } = await view()

    fireEvent.click(screen.getByText(/Price Target Expired/))

    expect(onNotificationClick).toHaveBeenCalledTimes(1)
  })

  it('opens the asset, not the price target record', async () => {
    const { onNotificationClick } = await view()

    fireEvent.click(screen.getByText(/Price Target Expired/))

    expect(onNotificationClick.mock.calls[0][0]).toMatchObject({
      type: 'asset',
      id: AMZN,
      title: 'AMZN',
    })
  })
})

describe('six rows for three targets read as one situation', () => {
  beforeEach(() => {
    rows = [
      expired({ id: 'n1', price_target_id: 'pt-bull' }),
      expired({ id: 'n2', price_target_id: 'pt-base' }),
      expired({ id: 'n3', price_target_id: 'pt-bear' }),
      expired({ id: 'n4', price_target_id: 'pt-bull' }),
      expired({ id: 'n5', price_target_id: 'pt-base' }),
      expired({ id: 'n6', price_target_id: 'pt-bear' }),
    ]
  })

  it('draws one line, saying how many targets need review', async () => {
    await view()

    expect(screen.getByText('AMZN targets expired')).toBeTruthy()
    expect(screen.getByText('3 targets need review')).toBeTruthy()
    expect(screen.queryAllByText(/Price Target Expired:/)).toHaveLength(0)
  })

  it('counts the situation once in the header tabs', async () => {
    await view()

    expect(screen.getByText('All (1)')).toBeTruthy()
    expect(screen.getByText('Unread (1)')).toBeTruthy()
  })

  it('still opens the asset from the consolidated row', async () => {
    const { onNotificationClick } = await view()

    fireEvent.click(screen.getByText('AMZN targets expired'))

    expect(onNotificationClick.mock.calls[0][0]).toMatchObject({ type: 'asset', id: AMZN })
  })
})

describe('notifications that never duplicated are unaffected', () => {
  it('lists two unrelated alerts as two rows', async () => {
    rows = [
      expired(),
      {
        id: 'n-note', user_id: 'user-1', type: 'note_shared',
        title: 'Note shared: AMZN Q1 review', message: 'Ada shared a note with you',
        context_type: 'note', context_id: 'note-1', context_data: {},
        is_read: false, created_at: '2026-03-15T10:00:00.000Z', read_at: null,
      },
    ]
    await view()

    expect(screen.getByText('All (2)')).toBeTruthy()
  })

  it('routes a shared note to the note, which used to be a dead tap', async () => {
    rows = [{
      id: 'n-note', user_id: 'user-1', type: 'note_shared',
      title: 'Note shared: AMZN Q1 review', message: 'Ada shared a note with you',
      context_type: 'note', context_id: 'note-1', context_data: {},
      is_read: false, created_at: '2026-03-15T10:00:00.000Z', read_at: null,
    }]
    const onNotificationClick = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <NotificationPane
          isOpen onToggle={() => {}} isFullscreen={false}
          onToggleFullscreen={() => {}} onNotificationClick={onNotificationClick}
        />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByText('Note shared: AMZN Q1 review'))

    expect(onNotificationClick.mock.calls[0][0]).toMatchObject({ type: 'note', id: 'note-1' })
  })
})

describe('the pane fills the sheet it is given', () => {
  it('declares no fixed rail of its own', async () => {
    rows = [expired()]
    const { container } = await view()
    const root = container.querySelector('div') as HTMLElement

    // It used to be `fixed right-0 top-16 bottom-0 w-96` INSIDE the
    // transformed CommunicationPane, which contains fixed descendants — so
    // the list rendered as a 384px column pinned to the sheet's right edge
    // and ran off a 360px screen.
    expect(root.className).not.toMatch(/\bfixed\b/)
    expect(root.className).not.toMatch(/\bw-96\b/)
    expect(root.className).toMatch(/\bh-full\b/)
  })
})

describe('a grouped notification can be opened up, not just counted', () => {
  beforeEach(() => {
    rows = [
      expired({ id: 'n1', price_target_id: 'pt-bull', scenario: 'Bull', target_price: 220 }),
      expired({ id: 'n2', price_target_id: 'pt-base', scenario: 'Base', target_price: 190 }),
      expired({ id: 'n3', price_target_id: 'pt-bear', scenario: 'Bear', target_price: 150 }),
      expired({ id: 'n4', price_target_id: 'pt-bull', scenario: 'Bull', target_price: 220 }),
      expired({ id: 'n5', price_target_id: 'pt-base', scenario: 'Base', target_price: 190 }),
      expired({ id: 'n6', price_target_id: 'pt-bear', scenario: 'Bear', target_price: 150 }),
    ]
  })

  it('offers a way in, naming how many targets are behind the row', async () => {
    await view()

    expect(screen.getByText(/Show 3 targets/)).toBeTruthy()
  })

  it('keeps the detail closed until asked, so the inbox stays scannable', async () => {
    await view()

    expect(screen.queryByText('Bear')).toBeNull()
  })

  it('names every contributing target once opened', async () => {
    await view()
    fireEvent.click(screen.getByText(/Show 3 targets/))

    expect(screen.getByText('Bull')).toBeTruthy()
    expect(screen.getByText('Base')).toBeTruthy()
    expect(screen.getByText('Bear')).toBeTruthy()
  })

  it('shows each target price and the horizon it lapsed on', async () => {
    await view()
    fireEvent.click(screen.getByText(/Show 3 targets/))

    expect(screen.getByText(/\$220\.00/)).toBeTruthy()
    expect(screen.getByText(/\$150\.00/)).toBeTruthy()
    expect(screen.getAllByText(/expired 2026-03-14/).length).toBe(3)
  })

  it('lists each target once, not once per duplicated row', async () => {
    await view()
    fireEvent.click(screen.getByText(/Show 3 targets/))

    expect(screen.getAllByText('Bull')).toHaveLength(1)
  })

  it('does not navigate when the disclosure is tapped', async () => {
    // The row's own tap still opens the asset. Opening the detail must not
    // hijack it, or inspecting what expired would leave the inbox.
    const { onNotificationClick } = await view()

    fireEvent.click(screen.getByText(/Show 3 targets/))

    expect(onNotificationClick).not.toHaveBeenCalled()
  })

  it('still opens the asset from the row itself', async () => {
    const { onNotificationClick } = await view()

    fireEvent.click(screen.getByText('AMZN targets expired'))

    expect(onNotificationClick.mock.calls[0][0]).toMatchObject({ type: 'asset', id: AMZN })
  })

  it('offers no disclosure on a notification that stands alone', async () => {
    rows = [expired({ id: 'only', price_target_id: 'pt-bull' })]
    await view()

    expect(screen.queryByText(/Show .* targets/)).toBeNull()
  })
})
