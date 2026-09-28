/**
 * The ops client-detail read path.
 *
 * The database tests prove attribution and authorization on a real cluster.
 * What is pinned here is the seam: that the page asks for the VIEWED org by
 * id, that bigint counts survive PostgREST's string serialisation, and that
 * a refusal is thrown rather than rendered as zero.
 *
 * That last one matters most. The defect this replaces returned HTTP 200
 * with a wrong number — so a client that silently coerced an error into
 * zeros would reproduce the same failure in a new place: a page that looks
 * like an unengaged client and is actually broken.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchOpsClientEngagement, fetchOpsClientPortfolios } from '../client-engagement'
import { supabase } from '../../supabase'

vi.mock('../../supabase', () => ({ supabase: { rpc: vi.fn() } }))
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>

const ORG = '22222222-2222-2222-2222-222222222222'

beforeEach(() => rpc.mockReset())

describe('fetchOpsClientEngagement', () => {
  it('asks for the viewed org by id, never for a member list', async () => {
    // Membership is not attribution — that assumption was the bug, so the
    // seam must not even carry user ids.
    rpc.mockResolvedValue({ data: [{}], error: null })
    await fetchOpsClientEngagement(ORG, '2026-09-01T00:00:00Z')

    expect(rpc).toHaveBeenCalledWith('ops_client_engagement', {
      p_org_id: ORG,
      p_since: '2026-09-01T00:00:00Z',
    })
    const args = rpc.mock.calls[0][1]
    expect(Object.keys(args).sort()).toEqual(['p_org_id', 'p_since'])
    expect(JSON.stringify(args)).not.toMatch(/user|member/i)
  })

  it('sends an explicit null when no window is given', async () => {
    rpc.mockResolvedValue({ data: [{}], error: null })
    await fetchOpsClientEngagement(ORG)
    expect(rpc.mock.calls[0][1].p_since).toBeNull()
  })

  it('coerces bigint counts, which PostgREST serialises as strings', async () => {
    rpc.mockResolvedValue({
      data: [{
        notes: '2', ratings: '1', ideas: '2', trade_ideas: '1',
        sessions: '2', avg_duration_seconds: 150,
        portfolio_count: '1', active_portfolios: '1',
      }],
      error: null,
    })

    const e = await fetchOpsClientEngagement(ORG)
    expect(e).toEqual({
      notes: 2, ratings: 1, ideas: 2, tradeIdeas: 1,
      sessions: 2, avgDurationSeconds: 150,
      portfolioCount: 1, activePortfolios: 1,
    })
    // Numbers, not numeric strings — `'2' + 1` is '21' on a dashboard.
    expect(typeof e.notes).toBe('number')
    expect(typeof e.portfolioCount).toBe('number')
  })

  it('reads the single row out of a RETURNS TABLE result', async () => {
    rpc.mockResolvedValue({ data: [{ notes: '7' }], error: null })
    expect((await fetchOpsClientEngagement(ORG)).notes).toBe(7)
  })

  it('returns zeros for an empty result rather than throwing', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect((await fetchOpsClientEngagement(ORG)).notes).toBe(0)
  })

  it('throws a refusal instead of reporting an unengaged client', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Platform admin required' } })
    await expect(fetchOpsClientEngagement(ORG)).rejects.toMatchObject({
      message: 'Platform admin required',
    })
  })
})

describe('fetchOpsClientPortfolios', () => {
  it('asks for the viewed org and maps the minimal metadata', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 'p1', name: 'Pilot Model Portfolio', is_active: true, created_at: 'x' }],
      error: null,
    })

    const rows = await fetchOpsClientPortfolios(ORG)
    expect(rpc).toHaveBeenCalledWith('ops_client_portfolios', { p_org_id: ORG })
    expect(rows).toEqual([
      { id: 'p1', name: 'Pilot Model Portfolio', isActive: true, createdAt: 'x' },
    ])
  })

  it('returns nothing rather than throwing when the org has no portfolios', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect(await fetchOpsClientPortfolios(ORG)).toEqual([])
  })

  it('throws a refusal', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Platform admin required' } })
    await expect(fetchOpsClientPortfolios(ORG)).rejects.toMatchObject({
      message: 'Platform admin required',
    })
  })
})
