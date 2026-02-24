import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { orgSwitchPerf } from '../org-switch-perf'

// Helper: create a mock fetch that returns a response with given body and status
function mockFetch(body: string, status = 200) {
  return async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(body, { status })
  }
}

describe('OrgSwitchPerfMonitor', () => {
  beforeEach(() => {
    // Ensure clean state
    orgSwitchPerf.stop()
  })

  afterEach(() => {
    orgSwitchPerf.stop()
  })

  it('starts with zero counts', () => {
    orgSwitchPerf.start()
    orgSwitchPerf.stop()
    const r = orgSwitchPerf.report()
    expect(r.requestCount).toBe(0)
    expect(r.totalBytes).toBe(0)
    expect(r.maxLatencyMs).toBe(0)
    expect(r.errors).toEqual([])
  })

  it('counts supabase requests', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mockFetch('ok') as typeof fetch
    orgSwitchPerf.start()
    await fetch('https://x.supabase.co/rest/v1/users')
    await fetch('https://x.supabase.co/rest/v1/orgs')
    orgSwitchPerf.stop()
    globalThis.fetch = original
    expect(orgSwitchPerf.report().requestCount).toBe(2)
  })

  it('ignores non-supabase requests', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mockFetch('ok') as typeof fetch
    orgSwitchPerf.start()
    await fetch('https://example.com/api/data')
    orgSwitchPerf.stop()
    globalThis.fetch = original
    expect(orgSwitchPerf.report().requestCount).toBe(0)
  })

  it('tracks errors from non-ok responses', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mockFetch('error', 500) as typeof fetch
    orgSwitchPerf.start()
    await fetch('https://x.supabase.co/rest/v1/broken')
    orgSwitchPerf.stop()
    globalThis.fetch = original
    const r = orgSwitchPerf.report()
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('500')
  })

  it('assertWithinBudget throws on too many requests', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mockFetch('ok') as typeof fetch
    orgSwitchPerf.start()
    for (let i = 0; i < 30; i++) {
      await fetch('https://x.supabase.co/rest/v1/t')
    }
    orgSwitchPerf.stop()
    globalThis.fetch = original
    expect(() => orgSwitchPerf.assertWithinBudget()).toThrow('30 requests')
  })

  it('assertWithinBudget passes within budget', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mockFetch('ok') as typeof fetch
    orgSwitchPerf.start()
    await fetch('https://x.supabase.co/rest/v1/t')
    orgSwitchPerf.stop()
    globalThis.fetch = original
    expect(() => orgSwitchPerf.assertWithinBudget()).not.toThrow()
  })

  it('records duration', async () => {
    orgSwitchPerf.start()
    await new Promise((r) => setTimeout(r, 50))
    orgSwitchPerf.stop()
    expect(orgSwitchPerf.report().durationMs).toBeGreaterThanOrEqual(30)
  })

  it('stops counting after stop()', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mockFetch('ok') as typeof fetch
    orgSwitchPerf.start()
    await fetch('https://x.supabase.co/rest/v1/t')
    orgSwitchPerf.stop()
    await fetch('https://x.supabase.co/rest/v1/t')
    globalThis.fetch = original
    expect(orgSwitchPerf.report().requestCount).toBe(1)
  })

  // --- v2: bytes tracking ---

  it('tracks response bytes', async () => {
    const body = 'x'.repeat(1024) // 1KB
    const original = globalThis.fetch
    globalThis.fetch = mockFetch(body) as typeof fetch
    orgSwitchPerf.start()
    await fetch('https://x.supabase.co/rest/v1/users')
    await fetch('https://x.supabase.co/rest/v1/orgs')
    orgSwitchPerf.stop()
    globalThis.fetch = original
    const r = orgSwitchPerf.report()
    expect(r.totalBytes).toBe(2048)
    expect(r.bytesOverBudget).toBe(false)
  })

  it('tracks max latency', async () => {
    const original = globalThis.fetch
    // Slow fetch that takes ~60ms
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise((r) => setTimeout(r, 60))
      return new Response('ok')
    }) as typeof fetch
    orgSwitchPerf.start()
    await fetch('https://x.supabase.co/rest/v1/slow')
    orgSwitchPerf.stop()
    globalThis.fetch = original
    const r = orgSwitchPerf.report()
    expect(r.maxLatencyMs).toBeGreaterThanOrEqual(40)
    expect(r.latencyOverBudget).toBe(false)
  })

  it('budget fails on bytes exceeded', async () => {
    const original = globalThis.fetch
    const bigBody = 'x'.repeat(3_000_000) // 3MB > 2MB budget
    globalThis.fetch = mockFetch(bigBody) as typeof fetch
    orgSwitchPerf.start()
    await fetch('https://x.supabase.co/rest/v1/big')
    orgSwitchPerf.stop()
    globalThis.fetch = original
    const r = orgSwitchPerf.report()
    expect(r.bytesOverBudget).toBe(true)
    expect(orgSwitchPerf.isOverBudget()).toBe(true)
    expect(() => orgSwitchPerf.assertWithinBudget()).toThrow('bytes')
  })

  it('budget fails on latency exceeded', async () => {
    orgSwitchPerf.latencyBudget = 20 // very tight budget
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      await new Promise((r) => setTimeout(r, 50))
      return new Response('ok')
    }) as typeof fetch
    orgSwitchPerf.start()
    await fetch('https://x.supabase.co/rest/v1/slow')
    orgSwitchPerf.stop()
    globalThis.fetch = original
    // Check before restoring budget — report() reads budget at call time
    const r = orgSwitchPerf.report()
    expect(r.latencyOverBudget).toBe(true)
    expect(orgSwitchPerf.isOverBudget()).toBe(true)
    expect(() => orgSwitchPerf.assertWithinBudget()).toThrow('latency')
    orgSwitchPerf.latencyBudget = 3000 // restore default
  })
})
