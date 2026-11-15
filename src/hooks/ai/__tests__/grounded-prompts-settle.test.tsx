/**
 * `useGroundedPromptFacts` — when it admits it does not know yet.
 *
 * ── The bug this exists to prevent ──────────────────────────────────────
 *
 * Opening the ACT AI pane flashed: the generic questions painted, then were
 * replaced by the grounded ones a moment later. The panel has a settle gate
 * built precisely to stop that, and the gate was working. It was being asked
 * the wrong question.
 *
 * React Query v5 defines `isLoading` as `isPending && isFetching`. A DISABLED
 * query is pending but not fetching, so it reports `isLoading: false` -- it
 * looks settled. This query is disabled until both the signed-in user and the
 * active organization are known, and on the very first paint neither is: the
 * org list is itself a fetch. So the gate opened on a query that had not run
 * and was not going to run yet.
 *
 * `isSettling` is the honest signal: the facts are unknown AND still coming.
 * These tests pin both halves of that, because the dangerous half is the
 * second one. A flag that is merely true-while-unknown would hold the pane's
 * thread area empty forever for a signed-out reader or one with no active
 * organization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/** What auth and the org context are reporting this moment. */
const world = {
  userId: null as string | null,
  authLoading: true,
  orgId: null as string | null,
  orgLoading: true,
}

vi.mock('../../useAuth', () => ({
  useAuth: () => ({ user: world.userId ? { id: world.userId } : null, loading: world.authLoading }),
}))

vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: world.orgId, isLoading: world.orgLoading }),
}))

/*
 * The six reads are irrelevant here and each one would need its own chainable
 * builder. What matters is whether the query is allowed to START, so the
 * client is stubbed to a shape that never resolves: any test that reaches it
 * is asking the wrong thing.
 */
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => { throw new Error('the query ran when it should not have') } },
}))

import { useGroundedPromptFacts } from '../useGroundedPrompts'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const render = (enabled = true) =>
  renderHook(() => useGroundedPromptFacts(enabled), { wrapper })

beforeEach(() => {
  world.userId = null
  world.authLoading = true
  world.orgId = null
  world.orgLoading = true
})

describe('it does not look settled before it has looked', () => {
  it('settles nothing while auth is still restoring', () => {
    const { result } = render()
    expect(result.current.isSettling).toBe(true)
  })

  it('still settles nothing once auth lands but the org list has not', () => {
    /*
     * This is the exact state that produced the flash. Auth resolves first and
     * fast; the org list is a separate fetch. With a user and no org the query
     * is still disabled, so `isLoading` is false and the panel believed the
     * facts were in.
     */
    world.userId = 'u1'
    world.authLoading = false
    const { result } = render()
    expect(result.current.isLoading, 'a disabled query reports isLoading false').toBe(false)
    expect(result.current.isSettling, 'but the facts are not known yet').toBe(true)
  })

  it('reports the gap between the two flags, which is the whole defect', () => {
    world.userId = 'u1'
    world.authLoading = false
    const { result } = render()
    expect(result.current.isSettling).not.toBe(result.current.isLoading)
  })
})

describe('it stops waiting for facts that are never coming', () => {
  it('settles for a signed-out reader rather than holding the pane', () => {
    /* Auth finished and there is no user. No facts will ever arrive, and a
       gate still waiting on them would leave an empty thread area forever. */
    world.authLoading = false
    world.orgLoading = false
    const { result } = render()
    expect(result.current.isSettling).toBe(false)
  })

  it('settles when the reader has no active organization', () => {
    world.userId = 'u1'
    world.authLoading = false
    world.orgLoading = false
    world.orgId = null
    const { result } = render()
    expect(result.current.isSettling).toBe(false)
  })

  it('settles immediately while the pane is shut, whatever else is loading', () => {
    /* A closed pane reads nothing, so it is not waiting for anything. Without
       this, a background pane would report settling for the life of the app. */
    const { result } = render(false)
    expect(result.current.isSettling).toBe(false)
  })
})

describe('the organization is part of the identity of these facts', () => {
  it('does not reuse one firm s facts after a switch to another', async () => {
    /*
     * The same signed-in user belongs to more than one organization, with
     * materially different counts. Keyed on the user alone, the second firm's
     * panel would quote the first firm's numbers until the stale time elapsed
     * -- a wrong number stated as a fact, which is the one thing a grounded
     * suggestion may not do.
     */
    const { groundedPromptsKey } = await import('../useGroundedPrompts')
    expect(groundedPromptsKey('u1', 'org-a')).not.toEqual(groundedPromptsKey('u1', 'org-b'))
  })
})
