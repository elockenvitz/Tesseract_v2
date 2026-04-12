/**
 * Org Switch Performance Instrumentation
 *
 * Lightweight counter that tracks supabase requests during org switch.
 * In development: logs counts to console.
 * In tests: exposes assertion helpers.
 *
 * Usage:
 *   orgSwitchPerf.start()
 *   await switchOrg(newOrgId)
 *   orgSwitchPerf.stop()
 *   console.log(orgSwitchPerf.report())
 */

export interface OrgSwitchPerfReport {
  requestCount: number
  totalBytes: number
  maxLatencyMs: number
  errors: string[]
  durationMs: number
  bytesOverBudget: boolean
  latencyOverBudget: boolean
}

const DEFAULT_BUDGET = 25
const MAX_BYTES_BUDGET = 2_097_152 // 2 MB
const MAX_LATENCY_BUDGET = 3000 // 3s

class OrgSwitchPerfMonitor {
  private _requestCount = 0
  private _totalBytes = 0
  private _maxLatencyMs = 0
  private _errors: string[] = []
  private _startTime = 0
  private _stopTime = 0
  private _active = false
  private _originalFetch: typeof globalThis.fetch | null = null
  budget = DEFAULT_BUDGET
  bytesBudget = MAX_BYTES_BUDGET
  latencyBudget = MAX_LATENCY_BUDGET

  /**
   * Start monitoring. Patches globalThis.fetch to count supabase requests.
   */
  start() {
    this.reset()
    this._active = true
    this._startTime = performance.now()

    // Patch fetch to intercept supabase calls
    this._originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const isSupabase = url.includes('/rest/v1/') || url.includes('/auth/v1/') || url.includes('/rpc/')

      if (isSupabase && this._active) {
        this._requestCount++
      }

      const reqStart = Date.now()

      try {
        const res = await this._originalFetch!(input, init)

        if (isSupabase && this._active) {
          const latency = Date.now() - reqStart
          if (latency > this._maxLatencyMs) this._maxLatencyMs = latency

          // Track response size
          try {
            const clone = res.clone()
            const buf = await clone.arrayBuffer()
            this._totalBytes += buf.byteLength
          } catch {
            // ignore clone/read errors
          }

          if (!res.ok) {
            this._errors.push(`${res.status} ${url.split('/rest/v1/')[1] || url}`)
          }
        }

        return res
      } catch (err: any) {
        if (isSupabase && this._active) {
          const latency = Date.now() - reqStart
          if (latency > this._maxLatencyMs) this._maxLatencyMs = latency
          this._errors.push(`NETWORK ${err.message}`)
        }
        throw err
      }
    }) as typeof globalThis.fetch
  }

  /**
   * Stop monitoring and restore original fetch.
   */
  stop() {
    this._active = false
    this._stopTime = performance.now()
    if (this._originalFetch) {
      globalThis.fetch = this._originalFetch
      this._originalFetch = null
    }
  }

  /**
   * Get the performance report.
   */
  report(): OrgSwitchPerfReport {
    return {
      requestCount: this._requestCount,
      totalBytes: this._totalBytes,
      maxLatencyMs: this._maxLatencyMs,
      errors: [...this._errors],
      durationMs: Math.round(this._stopTime - this._startTime),
      bytesOverBudget: this._totalBytes > this.bytesBudget,
      latencyOverBudget: this._maxLatencyMs > this.latencyBudget,
    }
  }

  /**
   * Assert request count, bytes, and latency are within budget.
   * Throws if over budget or if there are errors.
   */
  assertWithinBudget(customBudget?: number) {
    const limit = customBudget ?? this.budget
    const r = this.report()
    if (r.errors.length > 0) {
      throw new Error(
        `Org switch had ${r.errors.length} request error(s):\n${r.errors.join('\n')}`
      )
    }
    if (r.requestCount > limit) {
      throw new Error(
        `Org switch made ${r.requestCount} requests (budget: ${limit})`
      )
    }
    if (r.bytesOverBudget) {
      throw new Error(
        `Org switch transferred ${r.totalBytes} bytes (budget: ${this.bytesBudget})`
      )
    }
    if (r.latencyOverBudget) {
      throw new Error(
        `Org switch max request latency ${r.maxLatencyMs}ms (budget: ${this.latencyBudget}ms)`
      )
    }
  }

  /**
   * Check if any dimension exceeds budget.
   */
  isOverBudget(): boolean {
    const r = this.report()
    return (
      r.requestCount > this.budget ||
      r.totalBytes > this.bytesBudget ||
      r.maxLatencyMs > this.latencyBudget
    )
  }

  /**
   * Log report to console (dev mode).
   */
  logReport(label = 'Org Switch') {
    const r = this.report()
    const status = this.isOverBudget() ? 'OVER BUDGET' : 'OK'
  }

  private reset() {
    this._requestCount = 0
    this._totalBytes = 0
    this._maxLatencyMs = 0
    this._errors = []
    this._startTime = 0
    this._stopTime = 0
  }
}

/** Singleton instance */
export const orgSwitchPerf = new OrgSwitchPerfMonitor()
