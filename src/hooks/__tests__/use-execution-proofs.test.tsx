/**
 * The Trade Book's evidence read, and what it says when it cannot answer.
 *
 * This hook is the only thing standing between a failed `portfolio_trade_events`
 * read and a Trade Book row that says "no evidence" about a trade whose
 * evidence it was simply not allowed to see. `unavailable` is that guard, and
 * it is the whole reason the hook returns more than a Map.
 *
 * The reader is mocked; the real `useQuery` is not. The enabled gate, the
 * cache key and the loading state are the parts that decide what a row
 * renders, so they run for real.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const reader = vi.hoisted(() => ({
  calls: [] as string[][],
  result: { proofs: new Map<string, string>(), failed: false } as any,
  /** When set, the read never settles, so the hook stays in its loading state. */
  hang: false,
}))

vi.mock('../../lib/asset-decisions/execution-evidence', () => ({
  readExecutionProofs: (ids: string[]) => {
    reader.calls.push(ids)
    if (reader.hang) return new Promise(() => {})
    return Promise.resolve(reader.result)
  },
}))

import { useExecutionProofs } from '../useExecutionProofs'

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  reader.calls = []
  reader.result = { proofs: new Map(), failed: false }
  reader.hang = false
})

describe('it reports the grades when the read succeeds', () => {
  it('hands back each trade\'s grade and claims no problem', async () => {
    reader.result = {
      proofs: new Map([['at-1', 'assumed'], ['at-2', 'verified']]),
      failed: false,
    }
    const { result } = renderHook(() => useExecutionProofs(['at-1', 'at-2']), { wrapper })

    await waitFor(() => expect(result.current.unavailable).toBe(false))
    expect(result.current.proofs.get('at-1')).toBe('assumed')
    expect(result.current.proofs.get('at-2')).toBe('verified')
  })

  it('leaves a trade with no evidence absent rather than defaulting it', async () => {
    reader.result = { proofs: new Map([['at-1', 'assumed']]), failed: false }
    const { result } = renderHook(() => useExecutionProofs(['at-1', 'at-2']), { wrapper })

    await waitFor(() => expect(result.current.unavailable).toBe(false))
    expect(result.current.proofs.has('at-2')).toBe(false)
  })
})

describe('it fails safely when the evidence cannot be loaded', () => {
  it('stays unavailable when the read reports a failure', async () => {
    reader.result = { proofs: new Map(), failed: true }
    const { result } = renderHook(() => useExecutionProofs(['at-1']), { wrapper })

    await waitFor(() => expect(reader.calls.length).toBe(1))
    await waitFor(() => expect(result.current.unavailable).toBe(true))
    expect(result.current.proofs.size).toBe(0)
  })

  it('does not downgrade a partial answer to "no evidence"', async () => {
    // One chunk succeeded and one was denied: there IS a grade in the map,
    // and it still must not be presented as the final word.
    reader.result = { proofs: new Map([['at-1', 'assumed']]), failed: true }
    const { result } = renderHook(() => useExecutionProofs(['at-1', 'at-2']), { wrapper })

    await waitFor(() => expect(result.current.unavailable).toBe(true))
  })

  it('is unavailable from the first render, before any answer exists', () => {
    reader.hang = true
    const { result } = renderHook(() => useExecutionProofs(['at-1']), { wrapper })

    // Synchronous: a row rendering during the read must not say "no
    // evidence" for the fraction of a second before it arrives.
    expect(result.current.unavailable).toBe(true)
    expect(result.current.proofs.size).toBe(0)
  })

  it('never throws, so the Trade Book keeps rendering its trades', async () => {
    reader.result = { proofs: new Map(), failed: true }
    const { result } = renderHook(() => useExecutionProofs(['at-1']), { wrapper })
    await waitFor(() => expect(result.current.unavailable).toBe(true))
    expect(result.current.proofs).toBeInstanceOf(Map)
  })
})

describe('it reads once per set of trades', () => {
  it('does not read at all for an empty table, and reports no problem', () => {
    const { result } = renderHook(() => useExecutionProofs([]), { wrapper })
    expect(reader.calls).toHaveLength(0)
    // Nothing was asked, so nothing is unknown. An empty Trade Book must not
    // sprout an "Unavailable" badge.
    expect(result.current.unavailable).toBe(false)
  })

  it('does not refetch when the same trades arrive in a different order', async () => {
    reader.result = { proofs: new Map([['at-1', 'assumed']]), failed: false }
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useExecutionProofs(ids),
      { wrapper, initialProps: { ids: ['at-1', 'at-2'] } },
    )
    await waitFor(() => expect(result.current.unavailable).toBe(false))
    rerender({ ids: ['at-2', 'at-1'] })
    await waitFor(() => expect(result.current.unavailable).toBe(false))

    // Sorting the Trade Book is not a reason to re-read the evidence table.
    expect(reader.calls).toHaveLength(1)
  })

  it('de-duplicates and drops empty ids before asking', async () => {
    const { result } = renderHook(
      () => useExecutionProofs(['at-1', 'at-1', '', 'at-2']),
      { wrapper },
    )
    await waitFor(() => expect(result.current.unavailable).toBe(false))
    expect(reader.calls[0]).toEqual(['at-1', 'at-2'])
  })
})
