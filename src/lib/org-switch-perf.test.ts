import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { orgSwitchPerf } from './org-switch-perf'

describe('OrgSwitchPerfMonitor', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    // Mock fetch for all tests
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as any
  })

  afterEach(() => {
    // Restore original fetch
    orgSwitchPerf.stop()
    globalThis.fetch = realFetch
  })

  it('counts supabase REST requests', async () => {
    orgSwitchPerf.start()

    // Simulate supabase requests
    await fetch('https://example.supabase.co/rest/v1/workflows?select=*')
    await fetch('https://example.supabase.co/rest/v1/projects?select=*')
    // Non-supabase request should NOT be counted
    await fetch('https://cdn.example.com/asset.js')

    orgSwitchPerf.stop()
    const report = orgSwitchPerf.report()
    expect(report.requestCount).toBe(2)
    expect(report.errors).toHaveLength(0)
  })

  it('tracks errors from failed supabase requests', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({ ok: false, status: 403 })

    orgSwitchPerf.start()
    await fetch('https://example.supabase.co/rest/v1/workflows?select=*')
    orgSwitchPerf.stop()

    const report = orgSwitchPerf.report()
    expect(report.requestCount).toBe(1)
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toContain('403')
  })

  it('assertWithinBudget passes when under budget', async () => {
    orgSwitchPerf.start()
    await fetch('https://example.supabase.co/rest/v1/workflows')
    orgSwitchPerf.stop()

    expect(() => orgSwitchPerf.assertWithinBudget(5)).not.toThrow()
  })

  it('assertWithinBudget throws when over budget', async () => {
    orgSwitchPerf.start()
    for (let i = 0; i < 10; i++) {
      await fetch(`https://example.supabase.co/rest/v1/table${i}`)
    }
    orgSwitchPerf.stop()

    expect(() => orgSwitchPerf.assertWithinBudget(5)).toThrow('10 requests (budget: 5)')
  })

  it('assertWithinBudget throws on errors even if under count budget', async () => {
    ;(globalThis.fetch as any).mockResolvedValueOnce({ ok: false, status: 500 })

    orgSwitchPerf.start()
    await fetch('https://example.supabase.co/rest/v1/broken')
    orgSwitchPerf.stop()

    expect(() => orgSwitchPerf.assertWithinBudget(100)).toThrow('request error')
  })

  it('stops counting after stop() is called', async () => {
    orgSwitchPerf.start()
    await fetch('https://example.supabase.co/rest/v1/a')
    orgSwitchPerf.stop()

    await fetch('https://example.supabase.co/rest/v1/b')
    expect(orgSwitchPerf.report().requestCount).toBe(1)
  })

  it('reports duration in milliseconds', async () => {
    orgSwitchPerf.start()
    await new Promise((r) => setTimeout(r, 10))
    orgSwitchPerf.stop()

    expect(orgSwitchPerf.report().durationMs).toBeGreaterThanOrEqual(5)
  })

  it('resets state on subsequent start() calls', async () => {
    orgSwitchPerf.start()
    await fetch('https://example.supabase.co/rest/v1/a')
    orgSwitchPerf.stop()
    expect(orgSwitchPerf.report().requestCount).toBe(1)

    orgSwitchPerf.start()
    orgSwitchPerf.stop()
    expect(orgSwitchPerf.report().requestCount).toBe(0)
  })
})
