import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../../supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const {
  fetchOpsQuickThoughtActivity,
  totalThoughtCount,
  activeAuthorIds,
} = await import('../quick-thought-activity')

beforeEach(() => rpc.mockReset())

describe('fetchOpsQuickThoughtActivity', () => {
  it('sends every filter explicitly, defaulting to null rather than omitting', async () => {
    // Omitting a parameter and passing null are different things to PostgREST:
    // an omitted arg falls back to the SQL DEFAULT, which happens to agree
    // today. Sending null keeps the call site's meaning independent of the
    // function signature.
    rpc.mockResolvedValue({ data: [], error: null })
    await fetchOpsQuickThoughtActivity()

    expect(rpc).toHaveBeenCalledWith('ops_quick_thought_activity', {
      p_user_ids: null,
      p_since: null,
      p_idea_type: null,
      p_exclude_archived: false,
    })
  })

  it('passes the caller filters through', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await fetchOpsQuickThoughtActivity({
      userIds: ['u1', 'u2'],
      since: '2026-01-01T00:00:00Z',
      ideaType: 'prompt',
      excludeArchived: true,
    })

    expect(rpc).toHaveBeenCalledWith('ops_quick_thought_activity', {
      p_user_ids: ['u1', 'u2'],
      p_since: '2026-01-01T00:00:00Z',
      p_idea_type: 'prompt',
      p_exclude_archived: true,
    })
  })

  it('coerces the bigint count, which PostgREST serialises as a string', async () => {
    // Left as a string this silently turns every sum into concatenation:
    // "12" + "7" = "127" engagement events.
    rpc.mockResolvedValue({
      data: [{ created_by: 'u1', thought_count: '12', first_created_at: '2026-01-01T00:00:00Z' }],
      error: null,
    })

    const rows = await fetchOpsQuickThoughtActivity()
    expect(rows[0].thought_count).toBe(12)
    expect(typeof rows[0].thought_count).toBe('number')
  })

  it('returns an empty array when the RPC yields no rows', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(fetchOpsQuickThoughtActivity()).resolves.toEqual([])
  })

  it('throws when the RPC is refused, rather than reporting zero', async () => {
    // The whole reason Ops goes through an RPC is that a non-admin must get an
    // error. Swallowing it here would reintroduce exactly the failure mode the
    // RPC exists to prevent: a metric that reads as real and counts one tenant.
    rpc.mockResolvedValue({ data: null, error: { message: 'Platform admin required' } })
    await expect(fetchOpsQuickThoughtActivity()).rejects.toMatchObject({
      message: 'Platform admin required',
    })
  })

  it('normalises a missing first_created_at to null', async () => {
    rpc.mockResolvedValue({ data: [{ created_by: 'u1', thought_count: '1' }], error: null })
    const rows = await fetchOpsQuickThoughtActivity()
    expect(rows[0].first_created_at).toBeNull()
  })
})

describe('aggregation helpers', () => {
  const rows = [
    { created_by: 'u1', thought_count: 3, first_created_at: '2026-01-01T00:00:00Z' },
    { created_by: 'u2', thought_count: 0, first_created_at: null },
    { created_by: 'u3', thought_count: 5, first_created_at: '2026-02-01T00:00:00Z' },
  ]

  it('sums counts across authors', () => {
    expect(totalThoughtCount(rows)).toBe(8)
  })

  it('sums to zero for an empty result', () => {
    expect(totalThoughtCount([])).toBe(0)
  })

  it('counts only authors with at least one row', () => {
    // A zero-count author is not "active". Including them would inflate every
    // funnel stage that measures distinct participants.
    expect(activeAuthorIds(rows)).toEqual(new Set(['u1', 'u3']))
  })
})
