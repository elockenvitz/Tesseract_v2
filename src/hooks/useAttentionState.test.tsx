/**
 * Focused test for the durable attention-state hook.
 *
 * Proves the three things the stage is actually about:
 *   1. dispositions go through the existing SECURITY DEFINER RPCs,
 *   2. the client never sends a user id, so attribution stays server-derived,
 *   3. state is read from the server, not from browser storage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const BASE_ROWS = [
  { attention_id: 'dismissed-one', snoozed_until: null, dismissed_at: '2026-08-01T00:00:00.000Z', dismiss_reason: null },
  { attention_id: 'snoozed-live', snoozed_until: '2099-01-01T00:00:00.000Z', dismissed_at: null, dismiss_reason: null },
  { attention_id: 'snoozed-expired', snoozed_until: '2020-01-01T00:00:00.000Z', dismissed_at: null, dismiss_reason: null },
]

/**
 * A stateful fake of the server.
 *
 * A static fake would make the optimistic-update test a race: onSettled
 * refetches, and a fake that always replays the original rows would erase the
 * write the test just made. Applying the RPC to the fake's own rows is both
 * more honest and what actually exercises the loop -- write, refetch, still
 * hidden -- which is the property the stage promises.
 */
let serverRows = [...BASE_ROWS]

const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
  const id = args.p_attention_id as string
  const row = serverRows.find(r => r.attention_id === id)
    ?? (serverRows = [...serverRows, { attention_id: id, snoozed_until: null, dismissed_at: null, dismiss_reason: null }],
        serverRows[serverRows.length - 1])
  if (name === 'snooze_attention') row.snoozed_until = args.p_until as string
  if (name === 'unsnooze_attention') row.snoozed_until = null
  if (name === 'dismiss_attention' || name === 'dismiss_attention_with_reason') {
    row.dismissed_at = new Date().toISOString()
    row.dismiss_reason = (args.p_reason as string) ?? null
  }
  if (name === 'undismiss_attention') { row.dismissed_at = null; row.dismiss_reason = null }
  return { error: null }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...(args as [string, Record<string, unknown>])),
    from: () => ({ select: () => Promise.resolve({ data: serverRows.map(r => ({ ...r })), error: null }) }),
  },
}))

vi.mock('./useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const { useAttentionState } = await import('./useAttentionState')

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useAttentionState', () => {
  beforeEach(() => { rpc.mockClear(); serverRows = BASE_ROWS.map(r => ({ ...r })) })

  it('reads suppression from the server, applying snooze expiry', async () => {
    const { result } = renderHook(() => useAttentionState(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.isSuppressed('dismissed-one')).toBe(true)
    expect(result.current.isSuppressed('snoozed-live')).toBe(true)
    // Expired snooze returns on its own — no job, no cleanup.
    expect(result.current.isSuppressed('snoozed-expired')).toBe(false)
    expect(result.current.isSuppressed('never-touched')).toBe(false)
  })

  it('snoozes through snooze_attention and sends no user id', async () => {
    const { result } = renderHook(() => useAttentionState(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => result.current.snoozeForMe('decision:a2-execution-77', 24))
    await waitFor(() => expect(rpc).toHaveBeenCalled())

    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('snooze_attention')
    expect(args).toHaveProperty('p_attention_id', 'decision:a2-execution-77')
    expect(args).toHaveProperty('p_until')
    // Attribution is derived from auth.uid() inside the RPC. If the client
    // ever started sending an id, this is the test that would catch it.
    expect(Object.keys(args as object)).toEqual(['p_attention_id', 'p_until'])
  })

  it('dismisses through dismiss_attention when no reason is given', async () => {
    const { result } = renderHook(() => useAttentionState(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => result.current.dismissForMe('decision:x'))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(rpc.mock.calls[0][0]).toBe('dismiss_attention')
    expect(Object.keys(rpc.mock.calls[0][1] as object)).toEqual(['p_attention_id'])
  })

  it('uses the reasoned RPC when a reason is given, never a null reason', async () => {
    const { result } = renderHook(() => useAttentionState(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => result.current.dismissForMe('decision:x', 'no_longer_relevant'))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(rpc.mock.calls[0][0]).toBe('dismiss_attention_with_reason')
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_reason: 'no_longer_relevant', p_note: null })
  })

  it('exposes the reversals the app previously left unused', async () => {
    const { result } = renderHook(() => useAttentionState(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => result.current.unsnoozeForMe('k'))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(rpc.mock.calls[0][0]).toBe('unsnooze_attention')

    rpc.mockClear()
    act(() => result.current.undismissForMe('k'))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(rpc.mock.calls[0][0]).toBe('undismiss_attention')
  })

  it('hides the item and keeps it hidden after the server round trip', async () => {
    const { result } = renderHook(() => useAttentionState(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isSuppressed('optimistic')).toBe(false)

    act(() => result.current.dismissForMe('optimistic'))
    await waitFor(() => expect(result.current.isSuppressed('optimistic')).toBe(true))
  })

  it('says why an item is hidden', async () => {
    const { result } = renderHook(() => useAttentionState(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.suppressionFor('dismissed-one')).toMatchObject({ by: 'dismiss' })
    expect(result.current.suppressionFor('snoozed-live')).toMatchObject({ by: 'snooze' })
  })
})
